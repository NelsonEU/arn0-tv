/*
 * Screen saver: photos with a slow zoom, a clock and a caption, after a stretch with no input
 * on Home. Right skips to the next photo; any other key closes it (and that press does nothing else).
 *
 * Adapted from a design mockup rather than ported from it. The mockup's backdrop was nine
 * radial-gradients over a linear-gradient — the exact shape the Lab render probe measured at
 * 4.6 fps with 88 of 90 frames dropped (see the header of css/style.css). Here a photo fills
 * that role, the one gradient left is static and painted once, and everything that moves does
 * so through `transform` and `opacity`, which the compositor animates with no JavaScript per
 * frame. The poll below ticks once a second and only decides what is due.
 *
 * Burn-in is the reason anything moves at all: on this kind of panel a clock parked in one
 * corner for an hour is a real risk, so the zoom never settles, the corner text shifts on each
 * photo change, the clock moves to another corner every couple of minutes, and the whole thing
 * fades to black once the configured hour is up.
 */
(function () {
    'use strict';

    var $ = UI.$;

    var DELAYS = [
        { key: '3m', label: '3 min', ms: 3 * 60 * 1000 },
        { key: '5m', label: '5 min', ms: 5 * 60 * 1000 },
        { key: '10m', label: '10 min', ms: 10 * 60 * 1000 },
        { key: '15m', label: '15 min', ms: 15 * 60 * 1000 }
    ];

    // The design asks for a photo change every 60-90 s; these are the ends and the middle.
    var PHOTO_EVERY = [
        { key: '60s', label: '60 s', ms: 60 * 1000 },
        { key: '75s', label: '75 s', ms: 75 * 1000 },
        { key: '90s', label: '90 s', ms: 90 * 1000 }
    ];

    var DARK_AFTER = [
        { key: '30m', label: '30 min', ms: 30 * 60 * 1000 },
        { key: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
        { key: '2h', label: '2 hours', ms: 2 * 60 * 60 * 1000 },
        { key: 'never', label: 'Never', ms: 0 }
    ];

    /*
     * The photo drifts rather than zooms. A zoom changes the layer's raster scale, and this
     * engine re-rasterises a scaled 1920x1080 layer in visible steps instead of compositing it
     * smoothly. A translate leaves the raster alone. The layer is laid out larger than the
     * screen (cover) so the panel stays filled while it pans.
     */
    var PAN_X = 160;                // overhang each side, matching .ss-photo in the stylesheet
    var PAN_Y = 90;
    var PAN_X_CONTAIN = 28;         // live landscape contain: mild drift (blur stays fixed)
    var PAN_Y_CONTAIN = 16;
    // Portrait contain: focus-zoom (screensaver only; Home stays light).
    // Zoom may be cut mid-leg when the photo changes — factor > 1 keeps it slow.
    var ZOOM_PORTRAIT = 1.50;
    var ZOOM_LEG_FACTOR = 1.25;
    var HELD_LEG_MS = 90 * 1000;    // one leg of the drift when a single photo is held
    var CLOCK_MOVE_MS = 150 * 1000; // "every 2-3 minutes"
    var CLOCK_POSITIONS = 4;        // .ss-clock.pos-0 .. pos-3
    var CLOCK_FADE_MS = 1500;       // fade out, move corner, fade in (matches .ss-clock transition)
    var SCROLL_EVERY_MS = 60 * 1000; // repeat the scroll of long caption / music lines (3 × 14 s pass + pause)
    var FADE_MS = 2000;             // crossfade, also set as the default in the stylesheet
    var POLL_MS = 1000;

    var open = false;
    var returnTo = 'home';
    var lastInput = Date.now();
    var layers = [];
    var front = 0;              // which of the two photo layers is showing
    var photoToken = 0;
    var photoIndex = 0;
    var openedAt = 0;
    var nextPhotoAt = 0;
    var nextClockMoveAt = 0;
    var nextScrollAt = 0;
    var captionText = '';
    var nextPanAt = 0;
    var panSign = 1;            // flipped on each leg, so the drift alternates direction
    var lastClockText = '';
    var clockPos = 0;
    var dark = false;
    var advancing = false;      // one in-flight live takeNext (timer or remote)
    var shownKey = '';          // live polish may update caption after the photo is up

    function prefs() { return Prefs.get().screensaver; }

    function option(list, key, fallback) {
        return list.find(function (o) { return o.key === key; }) ||
            list.find(function (o) { return o.key === fallback; });
    }

    function delay() { return option(DELAYS, prefs().delay, '5m'); }
    function photoEvery() { return option(PHOTO_EVERY, prefs().photoEvery, '75s'); }
    function darkAfter() { return option(DARK_AFTER, prefs().dark, '1h'); }

    // ---------- Photos

    function rotating() {
        var mode = Prefs.get().wallpaper.mode;
        if (mode === 'live') {
            // Live keeps an upcoming plan; do not require history length > 1.
            return !!(window.LiveWallpaper && LiveWallpaper.isOnDemand && LiveWallpaper.isOnDemand()) ||
                Wallpaper.list().length > 1;
        }
        return mode === 'rotate' && Wallpaper.list().length > 1;
    }

    /*
     * The photo follows the Background setting: Off shows no photo, Photo holds the chosen one,
     * Rotate / Live cycle the lot. The index is the screen saver's own — advancing it must not
     * rewrite the Home wallpaper or restart its rotation clock, so Prefs.wallpaper is read, never written.
     */
    function photoAt(i) {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') return null;
        var list = Wallpaper.list();
        if (!list.length) return null;
        if (p.mode === 'rotate' || p.mode === 'live') {
            return list[((i % list.length) + list.length) % list.length];
        }
        return Wallpaper.find(p.mode === 'live' ? p.liveKey : p.photo);
    }

    // Continue from whatever is already on Home, so opening the screen saver is not a jump cut.
    function startIndex() {
        var p = Prefs.get().wallpaper;
        var key = p.mode === 'live' ? p.liveKey : p.photo;
        var i = Wallpaper.list().findIndex(function (w) { return w.key === key; });
        return i < 0 ? 0 : i;
    }

    // How long one leg of the drift lasts: a rotating photo drifts for exactly as long as it is up.
    function legMs() {
        return rotating() ? photoEvery().ms : HELD_LEG_MS;
    }

    function zoomLegMs() {
        return Math.max(8 * 1000, Math.round(legMs() * ZOOM_LEG_FACTOR));
    }

    function corner(sign) {
        return 'translate(' + (sign * PAN_X) + 'px, ' + (sign * PAN_Y) + 'px)';
    }

    function containCorner(sign) {
        return 'translate(' + (sign * PAN_X_CONTAIN) + 'px, ' + (sign * PAN_Y_CONTAIN) + 'px)';
    }

    // sign > 0 = zoomed out; sign < 0 = focus-in.
    function portraitScale(sign) {
        return 'scale(' + (sign > 0 ? 1 : ZOOM_PORTRAIT) + ')';
    }

    function sharpEl(layer) {
        return layer.querySelector('.ss-photo-img');
    }

    /*
     * Place a layer at the start of its drift with no animation. The suppression has to be
     * inline rather than a class, because startPan sets `transition` inline and an inline
     * declaration beats a class rule.
     * Contain (live): layer + blur stay fixed. Landscape nudges; portrait focus-zooms.
     */
    function resetPan(layer, sign) {
        var sharp = sharpEl(layer);
        if (layer.classList.contains('contain')) {
            layer.style.transition = 'none';
            layer.style.transform = 'none';
            if (sharp) {
                sharp.style.transition = 'none';
                sharp.style.transform = layer.classList.contains('portrait')
                    ? portraitScale(sign)
                    : containCorner(sign);
                void sharp.offsetWidth;
            }
            return;
        }
        if (sharp) {
            sharp.style.transition = 'none';
            sharp.style.transform = 'translate(0, 0)';
        }
        layer.style.transition = 'none';
        layer.style.transform = corner(sign);
        // Reading a layout property flushes that, so the transition startPan restores runs from
        // this corner instead of being collapsed into the move away from it.
        void layer.offsetWidth;
    }

    /*
     * The drift is one CSS transition per leg: set once, run by the compositor, no JavaScript
     * per frame. Duration follows Screen saver → photo every (or the held-photo leg).
     */
    function startPan() {
        panSign = -panSign;
        nextPanAt = Date.now() + legMs();
        var layer = layers[front];
        var sharp = sharpEl(layer);
        var move = 'transform ' + legMs() + 'ms linear';
        if (layer.classList.contains('contain')) {
            layer.style.transition = 'opacity ' + FADE_MS + 'ms linear';
            layer.style.transform = 'none';
            if (sharp) {
                var portrait = layer.classList.contains('portrait');
                sharp.style.transition = portrait
                    ? ('transform ' + zoomLegMs() + 'ms linear')
                    : move;
                sharp.style.transform = portrait ? portraitScale(panSign) : containCorner(panSign);
            }
            return;
        }
        layer.style.transition = 'opacity ' + FADE_MS + 'ms linear, ' + move;
        layer.style.transform = corner(panSign);
    }

    /*
     * The incoming photo is decoded on the hidden layer before anything fades, so a slow decode
     * cannot show as a flash of empty background. A token abandons a decode that finishes after
     * the next change, or after the screen saver has closed.
     */
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

    function showPhoto(w) {
        var token = ++photoToken;
        if (!w) {
            layers[0].style.opacity = '0';
            layers[1].style.opacity = '0';
            nextPanAt = 0;
            return;
        }
        applyTone(w.thumb || w.file, token);
        var swapped = false;
        var urls = photoUrls(w);
        var ui = 0;
        var swap = function (url, probe) {
            if (swapped || token !== photoToken || !open) return;
            swapped = true;
            var back = layers[1 - front];
            var old = layers[front];
            var imgEl = back.querySelector('.ss-photo-img');
            var blurEl = back.querySelector('.ss-photo-blur');
            // Portrait = taller than wide (from decoded pixels). Only those get contain+blur+zoom;
            // landscape fills the panel with cover + the usual pan.
            var portrait = !!(probe && probe.naturalWidth && probe.naturalHeight > probe.naturalWidth);
            var contain = portrait;
            back.classList.toggle('contain', contain);
            back.classList.toggle('portrait', portrait);
            back.classList.toggle('landscape', !portrait);
            if (imgEl) imgEl.src = url;
            else back.style.backgroundImage = 'url("' + url + '")';
            if (blurEl) {
                // Blur the small thumb — full-size originals + filter:blur are costly on this TV.
                if (contain) blurEl.src = w.thumb || url;
                else blurEl.removeAttribute('src');
            }
            // Placed at the corner startPan is about to drift away from, animation suppressed.
            resetPan(back, panSign);
            front = 1 - front;
            // Restores the transition before either property is given a new value, so the
            // crossfade and the drift both animate instead of jumping.
            startPan();
            back.style.opacity = '1';
            old.style.opacity = '0';
        };
        var img = new Image();
        img.onload = function () { swap(urls[ui], img); };
        img.onerror = function () {
            ui++;
            if (ui < urls.length) {
                img.src = urls[ui];
                return;
            }
            DevLog.log('Screen saver photo failed: ' + w.file);
        };
        img.src = urls[0];
        if (img.complete && img.naturalWidth) swap(urls[0], img);
    }

    // ---------- Text tone

    // Text is white by default. Where the photo is bright behind the caption, the text switches
    // to dark. The brightness is read from a CORS-enabled copy of the image; a host without CORS
    // headers keeps the white default, and the photo itself is never affected.
    var TONE_W = 64;
    var TONE_H = 36;
    var SCRIM_KEEP = 0.5;        // share of the photo still visible under the caption scrim
    var DARK_TEXT_ABOVE = 0.38;  // relative luminance (after scrim) above which dark text reads better
    var toneCache = {};

    function linear(c) {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function measureTone(url, done) {
        if (toneCache[url]) { done(toneCache[url]); return; }
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            var tone = 'white';
            try {
                var c = document.createElement('canvas');
                c.width = TONE_W;
                c.height = TONE_H;
                var ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0, TONE_W, TONE_H);
                // Bottom-left: where the caption sits.
                var w = Math.round(TONE_W * 0.4);
                var h = Math.round(TONE_H * 0.4);
                var data = ctx.getImageData(0, TONE_H - h, w, h).data;
                var sum = 0;
                for (var i = 0; i < data.length; i += 4) {
                    sum += 0.2126 * linear(data[i]) + 0.7152 * linear(data[i + 1]) + 0.0722 * linear(data[i + 2]);
                }
                var lum = SCRIM_KEEP * sum / (data.length / 4);
                tone = lum > DARK_TEXT_ABOVE ? 'dark' : 'white';
            } catch (e) {
                // Tainted canvas (no CORS on the host): keep the white default.
            }
            toneCache[url] = tone;
            done(tone);
        };
        img.onerror = function () { done('white'); };
        img.src = url;
    }

    function applyTone(url, token) {
        measureTone(url, function (tone) {
            if (token !== photoToken || !open) return;
            $('screensaver').classList.toggle('tone-dark', tone === 'dark');
        });
    }

    // ---------- Text

    // The design asks for "Wed 21 Oct"; Appearance.date is the long form Home uses.
    function shortDate(d) {
        try {
            var text = d.toLocaleDateString(Prefs.get().appearance.locale,
                { weekday: 'short', day: 'numeric', month: 'short' });
            return text.charAt(0).toUpperCase() + text.slice(1);
        } catch (e) {
            return d.toDateString();
        }
    }

    // Called every second, but only writes when the minute turns: repainting the clock text on
    // top of a drifting photo is work the compositor does not need.
    function updateClock() {
        var d = new Date();
        var t = Appearance.time(d);
        var text = t.time + (t.suffix ? ' ' + t.suffix : '');
        if (text === lastClockText) return;
        lastClockText = text;
        $('ss-time').textContent = text;
        $('ss-date').textContent = Prefs.get().appearance.showDate ? shortDate(d) : '';
    }

    function caption(w) {
        // Title + date/credit from live metadata (title/sub/credit on each wallpaper entry).
        captionText = w ? (w.title || w.credit || '') : '';
        var sub = '';
        if (w) {
            if (w.sub && w.credit && w.credit !== w.title) sub = w.sub + ' · ' + w.credit;
            else sub = w.sub || (w.credit && w.credit !== captionText ? w.credit : '') || '';
        }
        if (window.Music) Music.fillMarquee($('ss-title'), captionText, true);
        else $('ss-title').textContent = captionText;
        $('ss-sub').textContent = sub;
        $('ss-caption').classList.toggle('hidden', !w || (!captionText && !sub));
    }

    // Long lines scroll for a few loops and freeze; repeating the scroll now and then keeps
    // them readable without a permanent animation.
    function refreshScroll() {
        if (window.Music) Music.fillMarquee($('ss-title'), captionText, true);
        renderMusic();
    }

    // Swaps the position class without touching the others, which now include `with-weather`.
    function setClockPos(n) {
        var el = $('ss-clock');
        for (var i = 0; i < CLOCK_POSITIONS; i++) el.classList.remove('pos-' + i);
        el.classList.add('pos-' + n);
    }

    function moveClock() {
        clockPos = (clockPos + 1) % CLOCK_POSITIONS;
        nextClockMoveAt = Date.now() + CLOCK_MOVE_MS;
        // Fade out, change corner while invisible, fade back in: a corner change cannot be
        // tweened because each corner sets different edge properties.
        var el = $('ss-clock');
        el.style.opacity = '0';
        setTimeout(function () {
            if (!open) return;
            setClockPos(clockPos);
            el.style.opacity = '1';
        }, CLOCK_FADE_MS);
    }

    // Hidden outright when there is no usable reading: see the note on staleness in weather.js.
    function renderWeather() {
        var w = window.Weather && Weather.current();
        $('ss-clock').classList.toggle('with-weather', !!w);
        $('ss-weather').classList.toggle('hidden', !w);
        if (!w) return;
        $('ss-wx-icon').innerHTML = w.icon;
        $('ss-wx-temp').textContent = w.temp;
        $('ss-wx-detail').textContent = w.detail;
    }

    function renderMusic() {
        var el = $('ss-music');
        if (!el) return;
        var show = window.Music && window.Subsonic && Subsonic.configured();
        el.classList.toggle('hidden', !show);
        if (!show) return;
        var song = Music.current();
        if (song) {
            Music.fillMarquee($('ss-music-title'), song.title, true);
            Music.fillMarquee($('ss-music-artist'), song.artist || song.album || '', true);
        } else {
            Music.fillMarquee($('ss-music-title'), 'Not playing', false);
            Music.fillMarquee($('ss-music-artist'), '', false);
        }
    }

    // ---------- Open, tick, close

    function openSaver() {
        if (open) return;
        returnTo = UI.current() || 'home';
        open = true;
        dark = false;
        front = 0;
        clockPos = 0;
        photoIndex = startIndex();
        panSign = 1;
        lastClockText = '';
        layers[0].style.opacity = '0';
        layers[1].style.opacity = '0';
        resetPan(layers[0], panSign);
        resetPan(layers[1], panSign);
        $('ss-dark').style.opacity = '0';
        setClockPos(0);
        $('ss-clock').style.opacity = '1';

        var now = Date.now();
        openedAt = now;
        nextPhotoAt = now + photoEvery().ms;
        nextClockMoveAt = now + CLOCK_MOVE_MS;
        nextScrollAt = now + SCROLL_EVERY_MS;
        nextPanAt = 0;

        UI.show('screensaver');
        updateClock();
        // Shows the cached reading at once, and asks for a new one only if the hour is up.
        renderWeather();
        renderMusic();
        if (window.Weather) Weather.refresh();
        var w = photoAt(photoIndex);
        shownKey = (w && w.key) || '';
        caption(w);
        showPhoto(w);
        DevLog.log('Screen saver on');
    }

    function goDark() {
        dark = true;
        $('ss-dark').style.opacity = '1';
        DevLog.log('Screen saver dark after ' + darkAfter().label);
    }

    function wakeFromDark() {
        if (!dark) return;
        dark = false;
        $('ss-dark').style.opacity = '0';
    }

    function applyPhoto(w) {
        if (!open || !w) return;
        var list = Wallpaper.list();
        var ni = list.findIndex(function (x) { return x.key === w.key; });
        photoIndex = ni < 0 ? photoIndex : ni;
        shownKey = w.key || '';
        caption(w);
        showPhoto(w);
    }

    // Immich (and similar) polish place/title after paint; refresh only the caption in place.
    function refreshCaptionIfShown() {
        if (!open || !shownKey) return;
        var w = Wallpaper.find(shownKey);
        if (w) caption(w);
    }

    // Timer and remote Right both land here so the interval resets after a manual skip.
    function advancePhoto() {
        if (!rotating() || advancing) return false;
        nextPhotoAt = Date.now() + photoEvery().ms;
        if (Prefs.get().wallpaper.mode === 'live' &&
            window.LiveWallpaper && LiveWallpaper.isOnDemand && LiveWallpaper.isOnDemand()) {
            advancing = true;
            LiveWallpaper.takeNext().then(function (w) {
                advancing = false;
                if (!open) return;
                // Plan miss / slow fill: fall back to recent history so the frame still changes.
                if (!w) {
                    var hist = Wallpaper.list();
                    if (!hist.length) return;
                    var cur = photoAt(photoIndex);
                    w = hist.length > 1
                        ? Wallpaper.pickNext(hist, cur && cur.key, !!Prefs.get().wallpaper.random)
                        : hist[0];
                    if (!w || (cur && w.key === cur.key && hist.length < 2)) return;
                }
                applyPhoto(w);
            }, function () { advancing = false; });
            return true;
        }
        var list = Wallpaper.list();
        var cur = photoAt(photoIndex);
        var next = Wallpaper.pickNext(list, cur && cur.key, !!Prefs.get().wallpaper.random);
        var ni = next ? list.findIndex(function (x) { return x.key === next.key; }) : -1;
        photoIndex = ni < 0 ? photoIndex + 1 : ni;
        applyPhoto(next || photoAt(photoIndex));
        return true;
    }

    function tick() {
        var now = Date.now();
        updateClock();
        var until = darkAfter().ms;
        if (!dark && until && now - openedAt >= until) goDark();
        // Behind an opaque black layer there is nothing worth moving.
        if (dark) return;
        if (now >= nextClockMoveAt) moveClock();
        if (now >= nextScrollAt) {
            nextScrollAt = now + SCROLL_EVERY_MS;
            refreshScroll();
        }
        if (rotating() && now >= nextPhotoAt) {
            advancePhoto();
        } else if (nextPanAt && now >= nextPanAt) {
            // A held photo has reached the far corner; send it back the other way.
            startPan();
        }
    }

    function close() {
        if (!open) return;
        open = false;
        advancing = false;
        shownKey = '';
        lastInput = Date.now();
        photoToken++;
        // Dropping the images releases full-screen textures on a 2 GB device.
        layers.forEach(function (l) {
            l.style.opacity = '0';
            l.style.backgroundImage = '';
            l.classList.remove('contain', 'portrait', 'landscape');
            var imgEl = l.querySelector('.ss-photo-img');
            var blurEl = l.querySelector('.ss-photo-blur');
            if (imgEl) imgEl.removeAttribute('src');
            if (blurEl) blurEl.removeAttribute('src');
        });
        UI.show(returnTo, { back: true });
    }

    // Never over a console input or another screen, and never while the app is in the background.
    function eligible() {
        return prefs().enabled && UI.isVisible('home') && !document.hidden &&
            !(window.Home && Home.tvMode());
    }

    /*
     * One poll for everything. The dismissing key is swallowed by the view's onKey below, so it
     * only closes the screen saver; this listener exists to notice input while it is closed.
     */
    document.addEventListener('keydown', function () {
        if (!open) lastInput = Date.now();
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            if (open) close();
            return;
        }
        // Coming back from another app is not idle time: JavaScript was paused, not waiting.
        lastInput = Date.now();
    });

    function init() {
        layers = [$('ss-photo-a'), $('ss-photo-b')];
        // A reading that lands mid-session should appear without waiting for the next photo.
        if (window.Weather) {
            Weather.onUpdate(function () {
                if (open) renderWeather();
            });
        }
        if (window.Music) {
            Music.onUpdate(function () {
                if (open) renderMusic();
            });
        }
        if (window.LiveWallpaper && LiveWallpaper.onChange) {
            LiveWallpaper.onChange(refreshCaptionIfShown);
        }
        UI.register('screensaver', {
            el: $('screensaver'),
            hints: [],
            rows: function () { return []; },
            onKey: function (k) {
                // Right = next photo (Rotate / Live). Anything else dismisses.
                if (k === UI.KEY.RIGHT && rotating()) {
                    wakeFromDark();
                    advancePhoto();
                    return true;
                }
                close();
                return true;
            },
            onBack: function () { close(); return true; }
        });
        setInterval(function () {
            if (open) {
                tick();
                return;
            }
            if (eligible() && Date.now() - lastInput >= delay().ms) openSaver();
        }, POLL_MS);
    }

    window.Screensaver = {
        DELAYS: DELAYS,
        PHOTO_EVERY: PHOTO_EVERY,
        DARK_AFTER: DARK_AFTER,
        delay: delay,
        photoEvery: photoEvery,
        darkAfter: darkAfter,
        init: init,
        open: openSaver,
        close: close,
        isOpen: function () { return open; },
        // Settings should not leave a countdown that started before the change.
        poke: function () { lastInput = Date.now(); }
    };
})();
