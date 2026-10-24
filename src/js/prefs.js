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
        var wx = cfg.weather || {};
        return {
            sound: {
                enabled: cfg.sound ? cfg.sound.enabled !== false : true,
                preset: cfg.sound && cfg.sound.preset || 'soft'
            },
            wallpaper: {
                mode: theme.wallpaper ? 'photo' : 'off',   // 'off' | 'photo' | 'rotate'
                photo: theme.wallpaper || 'forest',
                interval: '15m',        // see Wallpaper.INTERVALS
                source: 'builtin',      // 'builtin' photos, or 'online' (js/online-wallpapers.js)
                lastChange: 0
            },
            screensaver: {
                enabled: true,
                delay: '5m',            // see Screensaver.DELAYS
                photoEvery: '75s',      // see Screensaver.PHOTO_EVERY
                dark: '1h'              // see Screensaver.DARK_AFTER
            },
            appearance: {
                clock: '24h',           // '24h' | '12h'
                showDate: true,
                locale: cfg.locale || 'en-GB',   // date and interface language (js/i18n.js)
                font: 'manrope',        // see Appearance.FONTS
                names: 'always',        // app names under tiles: 'always' | 'focused' | 'never'
                style: 'original',      // 'original' | 'tvos' (lift and sheen instead of the ring)
                order: 'manual',        // Home apps: 'manual' | 'recent' (last opened first)
                homeWeather: true       // weather next to the date on Home (when a city is set)
            },
            recent: {},                 // { appId: last launch time } for order: 'recent'
            returnHere: false,          // EXPERIMENTAL: come back to the launcher when an app closes
            weather: {
                city: null,             // display name; set from Settings → Weather
                latitude: typeof wx.latitude === 'number' ? wx.latitude : null,
                longitude: typeof wx.longitude === 'number' ? wx.longitude : null,
                unit: wx.unit || 'celsius'
            },
            home: null,                 // [{ id, label, brand }] once edited; null = config.js apps
            inputs: null,               // [{ hdmi, label, brand, method, hidden }] once edited; null = config.js
            hiddenApps: []              // app ids left out of All apps and Add apps (Green in All apps)
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
        try {
            var saved = JSON.parse(localStorage.getItem(KEY));
            if (saved) {
                merge(prefs.sound, saved.sound);
                merge(prefs.wallpaper, saved.wallpaper);
                merge(prefs.screensaver, saved.screensaver);
                merge(prefs.appearance, saved.appearance);
                merge(prefs.weather, saved.weather);
                if (saved.recent && typeof saved.recent === 'object') prefs.recent = saved.recent;
                prefs.returnHere = saved.returnHere === true;
                if (Array.isArray(saved.home) && saved.home.length) prefs.home = saved.home;
                if (Array.isArray(saved.inputs)) prefs.inputs = saved.inputs;
                if (Array.isArray(saved.hiddenApps)) prefs.hiddenApps = saved.hiddenApps;
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
        prefs = defaults();
    }

    window.Prefs = {
        get: function () { return prefs; },
        save: save,
        reset: reset
    };
})();
