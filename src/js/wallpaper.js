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

    function bundled() { return window.WALLPAPERS || []; }

    function isLive() { return Prefs.get().wallpaper.mode === 'live'; }

    // Active catalog for the current mode (bundled or live pool).
    function list() {
        return isLive() ? LiveWallpaper.list() : bundled();
    }

    function find(key) {
        if (isLive()) return LiveWallpaper.find(key);
        return bundled().find(function (w) { return w.key === key; }) || bundled()[0] || null;
    }

    function interval(key) {
        var findI = function (k) { return INTERVALS.find(function (i) { return i.key === k; }); };
        return findI(key) || findI('15m');
    }

    function bg() { return document.getElementById('bg'); }
    function scrim() { return document.getElementById('bg-scrim'); }

    function setScrim(on) {
        var el = scrim();
        if (el) el.classList.toggle('hidden', !on);
    }

    // The next image is decoded before it replaces the current one, so the screen never flashes empty.
    // No wallpaper falls back to the stylesheet's plain gradient (img/bg.jpg).
    function display(w) {
        var t = ++token;
        if (!w) {
            bg().style.backgroundImage = '';
            setScrim(false);
            return;
        }
        var img = new Image();
        img.onload = function () {
            if (t !== token) return;
            bg().style.backgroundImage = 'url("' + w.file + '")';
            setScrim(!!w.remote);
        };
        img.onerror = function () {
            DevLog.log('Wallpaper failed to load: ' + w.file);
            if (t === token && w.remote) setScrim(false);
        };
        img.src = w.file;
    }

    function currentKey() {
        var p = Prefs.get().wallpaper;
        return isLive() ? (p.liveKey || (list()[0] && list()[0].key)) : p.photo;
    }

    function apply() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') {
            display(null);
            return;
        }
        display(find(currentKey()));
    }

    function next() {
        var p = Prefs.get().wallpaper;
        var l = list();
        if (!l.length) return null;
        var key = currentKey();
        var i = l.findIndex(function (w) { return w.key === key; });
        var w = l[(i + 1) % l.length];
        if (isLive()) p.liveKey = w.key;
        else p.photo = w.key;
        p.lastChange = Date.now();
        if (p.mode === 'off') p.mode = 'photo';
        Prefs.save();
        apply();
        return w;
    }

    function due() {
        var p = Prefs.get().wallpaper;
        if (p.mode !== 'rotate' && p.mode !== 'live') return false;
        var ms = interval(p.interval).ms;
        return ms > 0 && Date.now() - p.lastChange >= ms;
    }

    function ensureLive(thenApply) {
        if (!isLive() || !window.LiveWallpaper) return;
        LiveWallpaper.ensureDaily().then(function (changed) {
            var p = Prefs.get().wallpaper;
            var l = LiveWallpaper.list();
            if (l.length && !LiveWallpaper.find(p.liveKey)) {
                p.liveKey = l[0].key;
                Prefs.save();
            }
            if (changed || thenApply) apply();
            if (!l.length && thenApply) UI.toast('Live wallpaper unavailable');
        });
    }

    // Called when Home appears (launch or return from another app).
    function homeShown() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'live') {
            ensureLive(false);
            if (p.interval === 'open' || due()) next();
            return;
        }
        if (p.mode === 'rotate' && (p.interval === 'open' || due())) next();
    }

    function start() {
        apply();
        if (isLive()) ensureLive(true);
        homeShown();
        // The screen saver has its own photo cycle and covers Home completely, so rotating
        // underneath it would only decode images nobody can see — and move the photo Home
        // comes back to.
        setInterval(function () {
            if (window.Screensaver && Screensaver.isOpen()) return;
            if (!document.hidden && due()) next();
            if (!document.hidden && isLive()) ensureLive(false);
        }, 5 * 1000);
    }

    window.Wallpaper = {
        INTERVALS: INTERVALS,
        list: list,
        bundled: bundled,
        find: find,
        interval: interval,
        apply: apply,
        next: next,
        homeShown: homeShown,
        start: start,
        isLive: isLive,
        ensureLive: function () { ensureLive(true); }
    };
})();

