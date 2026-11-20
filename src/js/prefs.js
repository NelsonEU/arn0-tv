/*
 * User settings, stored on the TV (localStorage). js/config.js only provides the defaults.
 * They survive restarts and in-place updates, but not an uninstall.
 */
(function () {
    'use strict';

    var KEY = 'arn0.prefs.v1';
    var LEGACY_WALLPAPER_KEY = 'arn0.wallpaper';

    function defaults() {
        var cfg = window.LAUNCHER_CONFIG || {};
        var theme = cfg.theme || {};
        return {
            sound: {
                enabled: cfg.sound ? cfg.sound.enabled !== false : true,
                preset: cfg.sound && cfg.sound.preset || 'soft'
            },
            wallpaper: {
                mode: theme.wallpaper ? 'photo' : 'off',   // 'off' | 'photo' | 'rotate' | 'live'
                photo: theme.wallpaper || 'forest',
                liveProvider: 'bing',   // 'bing' | 'nasa' | 'wikimedia' | 'unsplash' | 'immich' | 'mix'
                liveKey: '',            // current entry in the live pool (date key)
                interval: '15m',        // see Wallpaper.INTERVALS (rotate + live cycle)
                random: false,          // Shuffle: Mix = random provider; live/rotate = random photo
                lastChange: 0
            },
            screensaver: {
                enabled: true,
                delay: '5m',            // see Screensaver.DELAYS
                photoEvery: '75s',      // see Screensaver.PHOTO_EVERY
                dark: '1h'              // see Screensaver.DARK_AFTER
            },
            // Seeded from config.js weather; Settings → Weather edits these.
            weather: {
                place: 'off',           // 'off' | 'custom'
                latitude: null,
                longitude: null,
                label: null,            // display name when place === 'custom'
                unit: 'celsius'         // 'celsius' | 'fahrenheit'
            },
            // Subsonic ambient player (server/user/password live in Subsonic creds store).
            music: {
                enabled: false,
                playing: false,
                volume: 'med',          // Music.VOLUMES key: low | med | high
                source: 'random',       // 'random' | 'playlist'
                playlistId: null,
                playlistName: null
            },
            appearance: {
                clock: '24h',           // '24h' | '12h'
                showDate: true,
                locale: cfg.locale || 'en-GB',
                font: 'manrope',        // see Appearance.FONTS
                names: 'always'         // app names under tiles: 'always' | 'focused' | 'never'
            },
            home: null,                 // [{ id, label, brand }] once edited; null = config.js apps
            inputs: null                // [{ hdmi, label, brand, method, hidden }] once edited; null = config.js
        };
    }

    function merge(target, saved) {
        if (!saved) return;
        Object.keys(target).forEach(function (k) {
            if (saved[k] !== undefined) target[k] = saved[k];
        });
    }

    function load() {
        var prefs = defaults();
        if (window.Weather && Weather.seedFromConfig) Weather.seedFromConfig(prefs.weather);
        try {
            var saved = JSON.parse(localStorage.getItem(KEY));
            if (saved) {
                merge(prefs.sound, saved.sound);
                merge(prefs.wallpaper, saved.wallpaper);
                merge(prefs.screensaver, saved.screensaver);
                merge(prefs.weather, saved.weather);
                merge(prefs.music, saved.music);
                merge(prefs.appearance, saved.appearance);
                if (Array.isArray(saved.home) && saved.home.length) prefs.home = saved.home;
                if (Array.isArray(saved.inputs)) prefs.inputs = saved.inputs;
            } else {
                var legacy = localStorage.getItem(LEGACY_WALLPAPER_KEY);
                if (legacy) prefs.wallpaper.photo = legacy;
            }
        } catch (e) {
            // Unreadable storage: run with defaults.
        }
        // "Midnight" used to be a photo; it is now what Off shows.
        if (prefs.wallpaper.photo === 'midnight') {
            if (prefs.wallpaper.mode === 'photo') prefs.wallpaper.mode = 'off';
            prefs.wallpaper.photo = 'forest';
        }
        return prefs;
    }

    var prefs = load();

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(prefs));
            return true;
        } catch (e) {
            DevLog.log('Could not save settings: ' + DevLog.errorText(e));
            return false;
        }
    }

    function reset() {
        try {
            localStorage.removeItem(KEY);
            localStorage.removeItem(LEGACY_WALLPAPER_KEY);
        } catch (e) {
            // Nothing stored, nothing to clear.
        }
        if (window.LiveWallpaper) {
            LiveWallpaper.clearCache();
            if (LiveWallpaper.clearUnsplashKey) LiveWallpaper.clearUnsplashKey();
            if (LiveWallpaper.clearImmichLink) LiveWallpaper.clearImmichLink();
        }
        if (window.Subsonic) Subsonic.clearCreds();
        prefs = defaults();
    }

    window.Prefs = {
        get: function () { return prefs; },
        save: save,
        reset: reset
    };
})();
