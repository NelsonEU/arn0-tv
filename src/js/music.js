/*
 * Ambient Subsonic playback while the launcher is foreground (including screensaver).
 * Pauses on document.hidden when another app takes over. Starts only after a user gesture.
 */
(function () {
    'use strict';

    var BATCH = 20;
    var REFILL_AT = 3;
    var VOLUMES = [
        { key: 'low', label: 'Low', value: 0.18 },
        { key: 'med', label: 'Med', value: 0.35 },
        { key: 'high', label: 'High', value: 0.55 }
    ];

    var audio = null;
    var queue = [];
    var current = null;
    var fetching = false;
    var lastError = '';
    var toastSkip = false;
    var listeners = [];

    function prefs() {
        return Prefs.get().music;
    }

    function notify() {
        listeners.forEach(function (fn) {
            try { fn(); } catch (e) { /* ignore */ }
        });
    }

    function statusText() {
        if (!Subsonic.configured()) return 'Not configured — set server in Settings → Music';
        if (lastError) return lastError;
        if (current) {
            return current.title + (current.artist ? ' · ' + current.artist : '');
        }
        if (prefs().playing) return 'Loading…';
        return prefs().enabled ? 'Ready' : 'Off';
    }

    function ensureAudio() {
        if (audio) return audio;
        audio = new Audio();
        audio.preload = 'none';
        audio.addEventListener('ended', function () { next(true); });
        audio.addEventListener('error', function () {
            lastError = 'Stream failed';
            DevLog.log('Music: stream error');
            if (!toastSkip) {
                toastSkip = true;
                UI.toast('Music stream failed — skipping');
            }
            next(true);
        });
        applyVolume();
        return audio;
    }

    function applyVolume() {
        if (!audio) return;
        var p = prefs();
        var v = VOLUMES.find(function (o) { return o.key === p.volume; });
        audio.volume = v ? v.value : 0.35;
    }

    function refill() {
        if (fetching || !Subsonic.configured()) return Promise.resolve();
        fetching = true;
        return Subsonic.getRandomSongs(BATCH).then(function (songs) {
            fetching = false;
            lastError = '';
            songs.forEach(function (s) { queue.push(s); });
            DevLog.log('Music: queued ' + songs.length + ' random songs (' + queue.length + ' total)');
        }).catch(function (e) {
            fetching = false;
            lastError = (e && e.message) || 'Fetch failed';
            DevLog.log('Music: ' + lastError);
            UI.toast('Music: ' + lastError);
        });
    }

    function playSong(song, announce) {
        current = song;
        var a = ensureAudio();
        a.src = Subsonic.streamUrl(song.id);
        applyVolume();
        var playPromise = a.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(function (e) {
                lastError = 'Play blocked';
                DevLog.log('Music: play() failed: ' + (e && e.message ? e.message : e));
                prefs().playing = false;
                Prefs.save();
                notify();
            });
        }
        // Title lives on the Home dock; toast only when that bar is not on screen.
        if (announce && !barVisible()) {
            UI.toast(song.title + (song.artist ? ' · ' + song.artist : ''));
        }
        notify();
        if (queue.length < REFILL_AT) refill();
    }

    function next(auto) {
        if (!Subsonic.configured()) return;
        var p = prefs();
        if (!p.enabled) {
            p.enabled = true;
            Prefs.save();
        }
        p.playing = true;
        Prefs.save();
        if (!queue.length) {
            refill().then(function () {
                if (queue.length) next(auto);
                else notify();
            });
            return;
        }
        playSong(queue.shift(), !auto);
    }

    function play() {
        if (!Subsonic.configured()) {
            UI.toast('Set server, user and password in Music settings');
            return;
        }
        var p = prefs();
        p.enabled = true;
        p.playing = true;
        Prefs.save();
        toastSkip = false;
        lastError = '';
        if (current && audio && audio.src && audio.paused && !audio.ended) {
            applyVolume();
            audio.play().catch(function () { next(false); });
            notify();
            return;
        }
        next(false);
    }

    function pause() {
        var p = prefs();
        p.playing = false;
        Prefs.save();
        if (audio) audio.pause();
        notify();
    }

    function toggle() {
        if (isPlaying()) pause();
        else play();
    }

    function barVisible() {
        var bar = document.getElementById('music-bar');
        return !!(bar && !bar.classList.contains('hidden'));
    }

    /*
     * Long title/artist: scroll a few times, then freeze (ellipsis). Infinite animation was
     * a large idle-CPU cost on this SoC (~40%).
     */
    function fillMarquee(el, text, animate) {
        if (!el) return;
        el.classList.remove('scroll');
        el.innerHTML = '';
        if (!text) return;
        if (!animate) {
            el.textContent = text;
            return;
        }
        var track = document.createElement('div');
        track.className = 'marquee-track';
        var span = document.createElement('span');
        span.textContent = text;
        track.appendChild(span);
        el.appendChild(track);
        // Two frames: first paint after un-hiding (screensaver) needs a real clientWidth.
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (!el.contains(track)) return;
                if (track.scrollWidth <= el.clientWidth + 1) {
                    el.textContent = text;
                    return;
                }
                var copy = span.cloneNode(true);
                copy.setAttribute('aria-hidden', 'true');
                track.appendChild(copy);
                function freeze() {
                    track.removeEventListener('animationend', freeze);
                    if (!el.contains(track)) return;
                    el.classList.remove('scroll');
                    el.textContent = text;
                }
                track.addEventListener('animationend', freeze);
                el.classList.add('scroll');
            });
        });
    }

    function renderBar() {
        var bar = document.getElementById('music-bar');
        var sep = document.getElementById('home-music-sep');
        var clock = document.querySelector('#home .clock');
        if (!bar) return;
        var show = Subsonic.configured();
        var weatherOn = !!(clock && clock.classList.contains('with-weather'));
        bar.classList.toggle('hidden', !show);
        if (sep) sep.classList.toggle('hidden', !(show && weatherOn));
        if (clock) clock.classList.toggle('with-music', show);
        if (!show) return;

        var title = document.getElementById('music-now-title');
        var artist = document.getElementById('music-now-artist');
        var playIcon = bar.querySelector('.music-icon-play');
        var pauseIcon = bar.querySelector('.music-icon-pause');
        var playing = isPlaying();
        // Scroll on track change / when a song is shown; stops after 3 loops.
        if (current) {
            fillMarquee(title, current.title, true);
            fillMarquee(artist, current.artist || current.album || '', true);
        } else if (lastError) {
            fillMarquee(title, lastError, false);
            fillMarquee(artist, 'Music', false);
        } else {
            fillMarquee(title, 'Not playing', false);
            fillMarquee(artist, '', false);
        }
        if (playIcon) playIcon.classList.toggle('hidden', playing);
        if (pauseIcon) pauseIcon.classList.toggle('hidden', !playing);
    }

    function stop() {
        pause();
        current = null;
        if (audio) {
            audio.removeAttribute('src');
            audio.load();
        }
        notify();
    }

    function setEnabled(on) {
        var p = prefs();
        p.enabled = !!on;
        if (!on) {
            p.playing = false;
            if (audio) audio.pause();
        }
        Prefs.save();
        notify();
    }

    function setVolume(key) {
        prefs().volume = key;
        Prefs.save();
        applyVolume();
        notify();
    }

    function isPlaying() {
        return !!(audio && !audio.paused && !audio.ended && current);
    }

    function summary() {
        if (!Subsonic.configured()) return 'Not configured';
        var p = prefs();
        if (!p.enabled) return 'Off';
        if (isPlaying() && current) return current.title;
        return p.playing ? 'Playing' : 'On · paused';
    }

    function onVisibility() {
        if (document.hidden) {
            if (audio && !audio.paused) audio.pause();
            return;
        }
        // Back in the launcher: resume only if the user left music in a playing state.
        if (prefs().enabled && prefs().playing && current && audio && audio.src) {
            audio.play().catch(function () { /* gesture / stream may need Next */ });
        }
    }

    function init() {
        document.addEventListener('visibilitychange', onVisibility);
        applyVolume();
        // Do not auto-start: needs a remote gesture (Play on the dock or in Settings).
        if (prefs().playing && prefs().enabled) {
            prefs().playing = false;
            Prefs.save();
        }
        var playBtn = document.getElementById('music-btn-play');
        var nextBtn = document.getElementById('music-btn-next');
        if (playBtn) playBtn._item = { kind: 'music', action: 'toggle' };
        if (nextBtn) nextBtn._item = { kind: 'music', action: 'next' };
        listeners.push(renderBar);
        renderBar();
    }

    window.Music = {
        VOLUMES: VOLUMES,
        init: init,
        play: play,
        pause: pause,
        toggle: toggle,
        stop: stop,
        next: function () { next(false); },
        setEnabled: setEnabled,
        setVolume: setVolume,
        isPlaying: isPlaying,
        current: function () { return current; },
        statusText: statusText,
        summary: summary,
        renderBar: renderBar,
        fillMarquee: fillMarquee,
        barVisible: barVisible,
        onUpdate: function (fn) { listeners.push(fn); }
    };
})();
