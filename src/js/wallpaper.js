/* Wallpaper display and rotation, driven by Prefs.wallpaper. */
(function () {
    'use strict';

    var INTERVALS = [
        { key: 'open', label: 'Each time Home opens', ms: 0 },
        { key: '30s', label: '30 s', ms: 30 * 1000 },
        { key: '5m', label: '5 min', ms: 5 * 60 * 1000 },
        { key: '15m', label: '15 min', ms: 15 * 60 * 1000 },
        { key: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
        { key: '1d', label: 'Daily', ms: 24 * 60 * 60 * 1000 }
    ];

    var token = 0;

    // Online photos replace the built-in set once at least one is ready; until then, and offline,
    // the built-in set stands in.
    function list() {
        var online = window.OnlineWallpapers && OnlineWallpapers.enabled() ? OnlineWallpapers.list() : [];
        return online.length ? online : window.WALLPAPERS || [];
    }

    function find(key) {
        return list().find(function (w) { return w.key === key; }) || list()[0] || null;
    }

    function interval(key) {
        var find = function (k) { return INTERVALS.find(function (i) { return i.key === k; }); };
        return find(key) || find('15m');
    }

    function bg() { return document.getElementById('bg'); }

    // The next image is decoded before it replaces the current one, so the screen never flashes empty.
    // No wallpaper falls back to the stylesheet's plain gradient (img/bg.jpg).
    function display(w) {
        var t = ++token;
        if (!w) {
            bg().style.backgroundImage = '';
            return;
        }
        var img = new Image();
        img.onload = function () {
            if (t === token) bg().style.backgroundImage = 'url("' + w.file + '")';
        };
        img.onerror = function () { DevLog.log('Wallpaper failed to load: ' + w.file); };
        img.src = w.file;
    }

    function apply() {
        var p = Prefs.get().wallpaper;
        display(p.mode === 'off' ? null : find(p.photo));
    }

    function next() {
        var p = Prefs.get().wallpaper;
        var l = list();
        if (!l.length) return null;
        var i = l.findIndex(function (w) { return w.key === p.photo; });
        p.photo = l[(i + 1) % l.length].key;
        p.lastChange = Date.now();
        if (p.mode === 'off') p.mode = 'photo';
        Prefs.save();
        apply();
        if (window.OnlineWallpapers) OnlineWallpapers.fill();
        return find(p.photo);
    }

    function due() {
        var p = Prefs.get().wallpaper;
        var ms = interval(p.interval).ms;
        return p.mode === 'rotate' && ms > 0 && Date.now() - p.lastChange >= ms;
    }

    // Called when Home appears (launch or return from another app).
    function homeShown() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'rotate' && (p.interval === 'open' || due())) next();
    }

    function start() {
        // The first online photo replaces a built-in one as soon as it is ready.
        OnlineWallpapers.onChange(function () {
            var p = Prefs.get().wallpaper;
            var online = OnlineWallpapers.list();
            var showing = online.some(function (w) { return w.key === p.photo; });
            if (p.mode !== 'off' && !showing && online.length) {
                p.photo = online[0].key;
                p.lastChange = Date.now();
                Prefs.save();
                apply();
            }
        });
        OnlineWallpapers.start();
        apply();
        homeShown();
        // The screen saver has its own photo cycle and covers Home completely, so rotating
        // underneath it would only decode images nobody can see — and move the photo Home
        // comes back to.
        setInterval(function () {
            if (window.Screensaver && Screensaver.isOpen()) return;
            if (!document.hidden && due()) next();
        }, 5 * 1000);
    }

    window.Wallpaper = {
        INTERVALS: INTERVALS,
        list: list,
        find: find,
        interval: interval,
        apply: apply,
        next: next,
        homeShown: homeShown,
        start: start
    };
})();
