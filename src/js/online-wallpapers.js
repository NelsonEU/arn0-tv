/*
 * Online wallpapers: a fresh stream of landscape photos instead of the built-in ten.
 *
 * Source: Wikimedia Commons, Category:Featured pictures of landscapes — several hundred
 * community-curated photos under free licences, no API key, and thumbnails served with CORS, which
 * is what lets the canvas below read them back. Each batch starts at a random letter, so the order
 * differs every time.
 *
 * The readability scrim is baked into each photo once, on a canvas, exactly as
 * scripts/prepare-wallpapers.mjs does for the built-in set: a live gradient over a photo measured
 * at 4.6 fps on the reference TV (see css/style.css). The result is a plain JPEG blob, so Home and
 * the screen saver treat it like any other wallpaper.
 *
 * Work happens only while the launcher is in front, never while another app is. Chromium 56
 * encodes the JPEG on the main thread (about 0.9 s per photo on a UE50NU7025, against 20 ms for
 * the drawing), so a photo is only prepared after the remote has been still for QUIET_MS: nobody is
 * navigating, and the screen saver's drift runs on the compositor and does not notice. A small pool
 * is kept ready; the oldest photo leaves as a new one comes in.
 */
(function () {
    'use strict';

    var API = 'https://commons.wikimedia.org/w/api.php';
    var CATEGORY = 'Category:Featured pictures of landscapes';
    var POOL = 6;                 // prepared photos kept ready
    var W = 1920;
    var H = 1080;
    var MIN_RATIO = 1.3;          // landscape enough to crop to 16:9 without losing the subject
    var RETRY_MS = 10 * 60 * 1000;
    var QUIET_MS = 8000;          // remote untouched this long before the main thread is borrowed

    var pool = [];                // [{ key, title, file, thumb, credit }] ready to show
    var queue = [];               // candidates not prepared yet: { key, title, url, credit }
    var busy = false;
    var lastFailure = 0;
    var lastKey = 0;
    var waiting = null;
    var listeners = [];

    function enabled() {
        return Prefs.get().wallpaper.source === 'online';
    }

    function strip(html) {
        var d = document.createElement('div');
        d.innerHTML = html || '';
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function getJson(url) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = 10000;
            xhr.onload = function () {
                try {
                    if (xhr.status < 200 || xhr.status >= 300) throw new Error('HTTP ' + xhr.status);
                    resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                    reject(e);
                }
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send();
        });
    }

    function fetchBatch() {
        var letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        var url = API + '?action=query&format=json&origin=*' +
            '&generator=categorymembers&gcmtype=file&gcmlimit=20' +
            '&gcmtitle=' + encodeURIComponent(CATEGORY) +
            '&gcmsort=sortkey&gcmstartsortkeyprefix=' + letter +
            '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=' + W +
            '&iiextmetadatafilter=Artist|ObjectName|LicenseShortName';
        return getJson(url).then(function (data) {
            var pages = data.query && data.query.pages;
            if (!pages) return;
            var seen = {};
            pool.concat(queue).forEach(function (p) { seen[p.key] = true; });
            Object.keys(pages).forEach(function (id) {
                var page = pages[id];
                var info = page.imageinfo && page.imageinfo[0];
                if (!info || !info.thumburl || seen['commons:' + id]) return;
                if (info.width / info.height < MIN_RATIO || info.width < W) return;
                var meta = info.extmetadata || {};
                var title = strip(meta.ObjectName && meta.ObjectName.value) ||
                    page.title.replace(/^File:/, '').replace(/\.\w+$/, '');
                var artist = strip(meta.Artist && meta.Artist.value);
                var licence = strip(meta.LicenseShortName && meta.LicenseShortName.value);
                queue.push({
                    key: 'commons:' + id,
                    title: title.length > 60 ? title.slice(0, 57) + '…' : title,
                    url: info.thumburl,
                    credit: [artist, licence, 'Wikimedia Commons'].filter(Boolean).join(' · ')
                });
            });
            // Shuffle so one batch does not play in alphabetical order.
            for (var i = queue.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = queue[i];
                queue[i] = queue[j];
                queue[j] = tmp;
            }
        });
    }

    // Cover-crop to 1920x1080 and burn in the same scrim as the built-in wallpapers.
    function bake(img) {
        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        var g = canvas.getContext('2d');
        var scale = Math.max(W / img.width, H / img.height);
        var sw = W / scale;
        var sh = H / scale;
        g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);

        // radial-gradient(1300px 700px at 0% 0%, rgba(0,0,0,.55), transparent 70%)
        g.save();
        g.scale(1300 / 700, 1);
        var radial = g.createRadialGradient(0, 0, 0, 0, 0, 700);
        radial.addColorStop(0, 'rgba(0,0,0,0.55)');
        radial.addColorStop(0.7, 'rgba(0,0,0,0)');
        g.fillStyle = radial;
        g.fillRect(0, 0, W * 700 / 1300, H);
        g.restore();

        var linear = g.createLinearGradient(0, 0, 0, H);
        linear.addColorStop(0, 'rgba(0,0,0,0.25)');
        linear.addColorStop(0.3, 'rgba(0,0,0,0.30)');
        linear.addColorStop(0.62, 'rgba(0,0,0,0.62)');
        linear.addColorStop(1, 'rgba(0,0,0,0.82)');
        g.fillStyle = linear;
        g.fillRect(0, 0, W, H);

        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) resolve(URL.createObjectURL(blob));
                else reject(new Error('could not encode'));
            }, 'image/jpeg', 0.88);
        });
    }

    function load(url) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image failed')); };
            img.src = url;
        });
    }

    // The photo on screen is never revoked: it may be the one Home comes back to.
    function trim() {
        var current = Prefs.get().wallpaper.photo;
        while (pool.length > POOL) {
            var i = pool[0].key === current ? 1 : 0;
            URL.revokeObjectURL(pool[i].file);
            pool.splice(i, 1);
        }
    }

    function prepareOne() {
        var candidate = queue.shift();
        if (!candidate) return Promise.resolve();
        return load(candidate.url).then(bake).then(function (file) {
            pool.push({ key: candidate.key, title: candidate.title, file: file, thumb: file, credit: candidate.credit });
            trim();
            listeners.forEach(function (fn) { fn(); });
        }, function (err) {
            DevLog.log('Online wallpaper skipped (' + DevLog.errorText(err) + '): ' + candidate.url);
        });
    }

    function idle(fn) {
        if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 5000 });
        else setTimeout(fn, 200);
    }

    function quiet() {
        return Date.now() - lastKey >= QUIET_MS;
    }

    // One step at a time, each in an idle slot, and only while the launcher is the app in front.
    function fill() {
        if (!enabled() || busy || document.hidden) return;
        if (Date.now() - lastFailure < RETRY_MS) return;
        if (!quiet()) {
            if (!waiting) waiting = setTimeout(function () { waiting = null; fill(); }, QUIET_MS);
            return;
        }
        // Fill the pool, then keep two photos ahead of the one on screen, so the stream never stops.
        var at = pool.findIndex(function (p) { return p.key === Prefs.get().wallpaper.photo; });
        if (pool.length >= POOL && at < pool.length - 2) return;
        busy = true;
        idle(function () {
            // A key may have come in since the slot was asked for.
            if (queue.length && !quiet()) {
                busy = false;
                fill();
                return;
            }
            var step = queue.length ? prepareOne() : fetchBatch();
            step.then(function () {
                busy = false;
                fill();
            }, function (err) {
                busy = false;
                lastFailure = Date.now();
                DevLog.log('Online wallpapers unavailable: ' + DevLog.errorText(err));
            });
        });
    }

    function start() {
        document.addEventListener('keydown', function () { lastKey = Date.now(); }, true);
        document.addEventListener('visibilitychange', fill);
        setInterval(fill, 30 * 1000);
        fill();
    }

    window.OnlineWallpapers = {
        start: start,
        fill: fill,
        enabled: enabled,
        list: function () { return pool.slice(); },
        onChange: function (fn) { listeners.push(fn); }
    };
})();
