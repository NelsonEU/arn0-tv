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
    var lastHomeUrl = '';

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
    function bgPhoto() { return document.getElementById('bg-photo'); }
    function bgPhotoBlur() { return document.getElementById('bg-photo-blur'); }
    function scrim() { return document.getElementById('bg-scrim'); }

    function setScrim(on) {
        var el = scrim();
        if (el) el.classList.toggle('hidden', !on);
    }

    function photoUrls(w) {
        var list = [];
        function add(u) {
            if (u && list.indexOf(u) < 0) list.push(u);
        }
        add(w.file);
        add(w.fileFallback);
        (w.fileFallbacks || []).forEach(add);
        return list;
    }

    // Home is static (cover, no pan/blur), so use a sharp full-size URL. Tiny preview thumbs
    // looked soft behind the tiles. Screensaver still owns contain+blur and motion.
    function homeUrls(w) {
        var urls = [];
        function add(u) {
            if (u && urls.indexOf(u) < 0) urls.push(u);
        }
        // Prefer fullsize / main file; keep preview/thumb as last resorts only.
        add(w.fileFallback);
        add(w.file);
        (w.fileFallbacks || []).forEach(add);
        add(w.thumb);
        return urls.length ? urls : photoUrls(w);
    }

    function display(w) {
        var t = ++token;
        var photo = bgPhoto();
        var blur = bgPhotoBlur();
        if (!w) {
            lastHomeUrl = '';
            bg().style.backgroundImage = '';
            if (photo) {
                photo.removeAttribute('src');
                photo.classList.remove('on', 'contain');
            }
            if (blur) {
                blur.removeAttribute('src');
                blur.classList.remove('on');
            }
            setScrim(false);
            return;
        }
        var urls = homeUrls(w);

        var i = 0;
        var probe = new Image();
        function tryUrl() {
            if (i >= urls.length) {
                DevLog.log('Wallpaper failed to load: ' + w.file);
                if (t === token && w.remote) setScrim(false);
                return;
            }
            probe.onload = function () {
                if (t !== token) return;
                var url = urls[i];
                if (url === lastHomeUrl && photo && photo.classList.contains('on')) return;
                lastHomeUrl = url;
                bg().style.backgroundImage = 'none';
                if (blur) {
                    blur.removeAttribute('src');
                    blur.classList.remove('on');
                }
                if (photo) {
                    photo.src = url;
                    photo.classList.add('on');
                    photo.classList.remove('contain');
                }
                setScrim(!!w.remote);
            };
            probe.onerror = function () {
                i++;
                tryUrl();
            };
            probe.src = urls[i];
        }
        tryUrl();
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

    // Next catalog entry: sequential wrap, or random excluding the current key.
    function pickNext(l, key, random) {
        if (!l || !l.length) return null;
        if (!random || l.length < 2) {
            var i = l.findIndex(function (w) { return w.key === key; });
            return l[((i < 0 ? 0 : i) + 1) % l.length];
        }
        var others = l.filter(function (w) { return w.key !== key; });
        return others[Math.floor(Math.random() * others.length)];
    }

    // `done(w)` is called with the chosen entry (async for on-demand live sources).
    function next(done) {
        var p = Prefs.get().wallpaper;
        var finish = function (w) {
            if (typeof done === 'function') done(w || null);
            return w || null;
        };
        // Live on-demand: pull the next photo (prefetch if ready).
        if (isLive() && window.LiveWallpaper && LiveWallpaper.isOnDemand()) {
            LiveWallpaper.takeNext().then(function (w) {
                if (!w) return finish(null);
                p.lastChange = Date.now();
                Prefs.save();
                if (!(window.Screensaver && Screensaver.isOpen())) apply();
                finish(w);
            }, function () { finish(null); });
            return null;
        }
        var l = list();
        if (!l.length) return finish(null);
        var w = pickNext(l, currentKey(), !!p.random);
        if (!w) return finish(null);
        if (isLive()) p.liveKey = w.key;
        else p.photo = w.key;
        p.lastChange = Date.now();
        if (p.mode === 'off') p.mode = 'photo';
        Prefs.save();
        apply();
        return finish(w);
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
        // Mix publishes each source as it lands; apply the liveKey it just selected.
        if (window.LiveWallpaper) {
            LiveWallpaper.onChange(function () {
                if (!isLive()) return;
                if (window.Screensaver && Screensaver.isOpen()) return;
                var p = Prefs.get().wallpaper;
                var l = list();
                if (!l.length) return;
                if (!LiveWallpaper.find(p.liveKey)) {
                    p.liveKey = l[0].key;
                    Prefs.save();
                }
                // Skip no-op applies (metadata polish used to reload the same Home wallpaper).
                var cur = find(p.liveKey);
                var prefer = cur && homeUrls(cur)[0];
                if (prefer && prefer === lastHomeUrl) return;
                apply();
            });
        }
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
        pickNext: pickNext,
        apply: apply,
        next: next,
        homeShown: homeShown,
        start: start,
        isLive: isLive,
        ensureLive: function () { ensureLive(true); }
    };
})();

