/*
 * Weather for the screen saver, from Open-Meteo. No API key, free for non-commercial use.
 *
 * Place and unit live in Prefs (Settings → Weather). config.js only supplies defaults.
 * Place is Off, or a custom lat/lon/label from IP detect or Open-Meteo city search.
 * Older preset city keys in saved prefs are migrated to custom on load.
 *
 * There is no polling. A TV launcher spends most of its life in the background with JavaScript
 * paused, so a timer would be both useless and rude; instead the reading is refreshed when
 * something is about to show it, and never more than once an hour. The last reading is cached in
 * localStorage so the screen saver opens with real numbers rather than a blank corner, even after
 * the TV has been off.
 */
(function () {
    'use strict';

    var STORE_KEY = 'arn0.weather.v5';
    var ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
    var GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
    var IP_ENDPOINTS = [
        'https://ipwho.is/',
        'https://ipapi.co/json/'
    ];
    var FRESH_MS = 60 * 60 * 1000;
    var USABLE_MS = 3 * 60 * 60 * 1000;
    var TIMEOUT_MS = 8000;
    var RETRY_MS = 10 * 60 * 1000;

    // Former preset chips — kept only so saved prefs still resolve after the list was dropped.
    var LEGACY_PLACES = {
        paris: { label: 'Paris', latitude: 48.86, longitude: 2.35 },
        lyon: { label: 'Lyon', latitude: 45.76, longitude: 4.84 },
        marseille: { label: 'Marseille', latitude: 43.30, longitude: 5.37 },
        bordeaux: { label: 'Bordeaux', latitude: 44.84, longitude: -0.58 },
        lille: { label: 'Lille', latitude: 50.63, longitude: 3.06 },
        brussels: { label: 'Brussels', latitude: 50.85, longitude: 4.35 },
        amsterdam: { label: 'Amsterdam', latitude: 52.37, longitude: 4.90 },
        london: { label: 'London', latitude: 51.51, longitude: -0.13 },
        madrid: { label: 'Madrid', latitude: 40.42, longitude: -3.70 },
        barcelona: { label: 'Barcelona', latitude: 41.39, longitude: 2.17 },
        berlin: { label: 'Berlin', latitude: 52.52, longitude: 13.41 },
        rome: { label: 'Rome', latitude: 41.90, longitude: 12.50 },
        tirana: { label: 'Tirana', latitude: 41.33, longitude: 19.82 },
        newyork: { label: 'New York', latitude: 40.71, longitude: -74.01 }
    };

    function group(code) {
        if (code <= 1) return 'clear';
        if (code <= 3) return 'cloudy';
        if (code <= 48) return 'fog';
        if (code <= 57) return 'drizzle';
        if (code <= 67) return 'rain';
        if (code <= 77) return 'snow';
        if (code <= 84) return 'showers';
        if (code <= 86) return 'snow';
        return 'storm';
    }

    var LABELS = {
        'en-GB': {
            clear: 'Clear', cloudy: 'Cloudy', fog: 'Fog', drizzle: 'Drizzle',
            rain: 'Rain', showers: 'Showers', snow: 'Snow', storm: 'Thunderstorm'
        },
        'es-ES': {
            clear: 'Despejado', cloudy: 'Nublado', fog: 'Niebla', drizzle: 'Llovizna',
            rain: 'Lluvia', showers: 'Chubascos', snow: 'Nieve', storm: 'Tormenta'
        },
        'fr-FR': {
            clear: 'Dégagé', cloudy: 'Nuageux', fog: 'Brouillard', drizzle: 'Bruine',
            rain: 'Pluie', showers: 'Averses', snow: 'Neige', storm: 'Orage'
        }
    };

    var CLOUD = 'M7.5 18.5h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.5-1A3.75 3.75 0 0 0 7.5 18.5z';
    var SUN = '<circle cx="12" cy="13" r="3.8"/>' +
        '<path d="M12 7.8V5.6M12 18.2v2.2M6.8 13H4.6M17.2 13h2.2' +
        'M9.3 10.3L7.1 8.1M14.7 15.7l2.2 2.2M14.7 10.3l2.2-2.2M9.3 15.7L7.1 17.9"/>';

    var ICONS = {
        clear: SUN,
        cloudy: '<path d="' + CLOUD + '"/>',
        fog: '<path d="' + CLOUD + '"/><path d="M5 21h5M14 21h5"/>',
        drizzle: '<path d="' + CLOUD + '"/><path d="M10 21v1M14 21v1"/>',
        rain: '<path d="' + CLOUD + '"/><path d="M9 20.5v2.5M12.5 20.5v2.5M16 20.5v2.5"/>',
        showers: '<path d="' + CLOUD + '"/><path d="M9.5 20.5L8 23M13 20.5L11.5 23M16.5 20.5L15 23"/>',
        snow: '<path d="' + CLOUD + '"/><path d="M9 21.5h.01M12.5 22.5h.01M16 21.5h.01"/>',
        storm: '<path d="' + CLOUD + '"/><path d="M13 19.5l-3 3.5h4l-2.5 3"/>'
    };

    function icon(name) {
        return '<svg viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.6" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.cloudy) +
            '</svg>';
    }

    // ---------- Configuration (Prefs, with config.js as seed for defaults)

    function configDefaults() {
        return (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.weather) || {};
    }

    function prefsWeather() {
        return Prefs.get().weather;
    }

    // Turn old preset keys (paris, …) into custom lat/lon/label once.
    function migratePlace(p) {
        if (!p || p.place === 'off' || p.place === 'custom') return false;
        var legacy = LEGACY_PLACES[p.place];
        if (!legacy) {
            p.place = 'off';
            p.latitude = null;
            p.longitude = null;
            p.label = null;
            return true;
        }
        p.place = 'custom';
        p.latitude = legacy.latitude;
        p.longitude = legacy.longitude;
        p.label = p.label || legacy.label;
        return true;
    }

    function coords() {
        var p = prefsWeather();
        if (migratePlace(p)) Prefs.save();
        if (p.place === 'off' || !p.place) return null;
        if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
            return { latitude: p.latitude, longitude: p.longitude, unit: p.unit };
        }
        return null;
    }

    function configured() {
        return !!coords();
    }

    // Seed prefs.weather from config.js when the user has not chosen a place yet.
    function seedFromConfig(target) {
        var c = configDefaults();
        target.unit = c.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
        if (typeof c.latitude === 'number' && typeof c.longitude === 'number') {
            target.place = 'custom';
            target.latitude = c.latitude;
            target.longitude = c.longitude;
            target.label = typeof c.label === 'string' ? c.label : null;
        } else {
            target.place = 'off';
            target.latitude = null;
            target.longitude = null;
            target.label = null;
        }
        return target;
    }

    function getJson(url, done) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = TIMEOUT_MS;
        xhr.onload = function () {
            if (xhr.status < 200 || xhr.status >= 300) {
                done('HTTP ' + xhr.status);
                return;
            }
            try {
                done(null, JSON.parse(xhr.responseText));
            } catch (e) {
                done('bad JSON');
            }
        };
        xhr.onerror = function () { done('request failed'); };
        xhr.ontimeout = function () { done('request timed out'); };
        xhr.send();
    }

    function formatPlaceLabel(name, admin, country) {
        var parts = [name, admin, country].filter(Boolean);
        // Drop duplicate admin when it repeats the city name (e.g. Tirana / Tirana / Albania).
        var out = [];
        parts.forEach(function (p) {
            if (!out.length || out[out.length - 1].toLowerCase() !== String(p).toLowerCase()) {
                out.push(p);
            }
        });
        return out.join(', ');
    }

    function parseIpLocation(data) {
        if (!data || data.success === false) return null;
        var lat = data.latitude;
        var lon = data.longitude;
        if (typeof lat !== 'number' || typeof lon !== 'number') return null;
        if (!isFinite(lat) || !isFinite(lon)) return null;
        var label = formatPlaceLabel(data.city, data.region || data.region_code, data.country);
        if (!label) label = lat.toFixed(2) + ', ' + lon.toFixed(2);
        return { latitude: lat, longitude: lon, label: label };
    }

    function detectLocation(done) {
        var i = 0;
        function tryNext(err) {
            if (i >= IP_ENDPOINTS.length) {
                done(err || 'location lookup failed');
                return;
            }
            var url = IP_ENDPOINTS[i++];
            getJson(url, function (e, data) {
                if (e) {
                    tryNext(e);
                    return;
                }
                var loc = parseIpLocation(data);
                if (!loc) {
                    tryNext('no coordinates');
                    return;
                }
                done(null, loc);
            });
        }
        tryNext();
    }

    function searchPlaces(query, done) {
        var q = String(query || '').trim();
        if (q.length < 2) {
            done('type at least 2 characters');
            return;
        }
        var url = GEOCODE +
            '?name=' + encodeURIComponent(q) +
            '&count=8&language=en&format=json';
        getJson(url, function (err, data) {
            if (err) {
                done(err);
                return;
            }
            var rows = (data && data.results) || [];
            var out = [];
            rows.forEach(function (r) {
                if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return;
                var label = formatPlaceLabel(r.name, r.admin1, r.country);
                out.push({
                    latitude: r.latitude,
                    longitude: r.longitude,
                    label: label || r.name,
                    name: r.name
                });
            });
            done(null, out);
        });
    }

    function resolvePlace(lat, lon, label) {
        return {
            place: 'custom',
            latitude: lat,
            longitude: lon,
            label: label || 'Custom'
        };
    }

    // ---------- Cache

    var reading = null;
    var fetching = false;
    var lastFailure = 0;
    var listeners = [];

    function load() {
        try {
            reading = JSON.parse(localStorage.getItem(STORE_KEY));
        } catch (e) {
            reading = null;
        }
    }

    function store() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(reading));
        } catch (e) {
            // Without the cache we only lose the instant first paint.
        }
    }

    function clearReading() {
        reading = null;
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
        listeners.forEach(function (fn) { fn(); });
    }

    function age() {
        return reading && reading.at ? Date.now() - reading.at : Infinity;
    }

    function placeLabel() {
        var p = prefsWeather();
        if (migratePlace(p)) Prefs.save();
        if (p.place === 'off' || !p.place) return '';
        return p.label || 'Custom';
    }

    function dayLabel(iso, locale) {
        try {
            var d = new Date(iso + 'T12:00:00');
            return d.toLocaleDateString(locale, { weekday: 'short' });
        } catch (e) {
            return iso.slice(5);
        }
    }

    function current() {
        if (!configured() || !reading || age() > USABLE_MS) return null;
        var locale = Prefs.get().appearance.locale;
        var labels = LABELS[locale] || LABELS['en-GB'];
        var name = group(reading.code);
        var city = placeLabel();
        var days = (reading.days || []).map(function (d) {
            var g = group(d.code);
            return {
                label: dayLabel(d.date, locale),
                max: Math.round(d.max) + '°',
                min: Math.round(d.min) + '°',
                icon: icon(g)
            };
        });
        return {
            temp: Math.round(reading.temp) + '°',
            range: Math.round(reading.max) + '° / ' + Math.round(reading.min) + '°',
            place: city,
            detail: city ? city + ' · ' + labels[name] : labels[name],
            icon: icon(name),
            days: days
        };
    }

    function url() {
        var c = coords();
        if (!c) return '';
        return ENDPOINT +
            '?latitude=' + encodeURIComponent(c.latitude) +
            '&longitude=' + encodeURIComponent(c.longitude) +
            '&current=temperature_2m,weather_code' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
            '&forecast_days=8' +
            (c.unit === 'fahrenheit' ? '&temperature_unit=fahrenheit' : '') +
            '&timezone=auto';
    }

    function accept(data) {
        var now = data && data.current;
        var day = data && data.daily;
        if (!now || !day || typeof now.temperature_2m !== 'number') return false;
        if (!day.time || !day.temperature_2m_max || !day.temperature_2m_min) return false;
        // Strip: next 7 days after today (today is shown in the current block above).
        var days = [];
        for (var i = 1; i < day.time.length && days.length < 7; i++) {
            days.push({
                date: day.time[i],
                max: day.temperature_2m_max[i],
                min: day.temperature_2m_min[i],
                code: day.weather_code && typeof day.weather_code[i] === 'number' ? day.weather_code[i] : 3
            });
        }
        reading = {
            at: Date.now(),
            temp: now.temperature_2m,
            code: typeof now.weather_code === 'number' ? now.weather_code : 3,
            max: day.temperature_2m_max[0],
            min: day.temperature_2m_min[0],
            days: days
        };
        store();
        listeners.forEach(function (fn) { fn(); });
        return true;
    }

    function failed(why) {
        fetching = false;
        lastFailure = Date.now();
        DevLog.log('Weather: ' + why);
    }

    function refresh(force) {
        if (!configured() || fetching) return;
        if (!force && age() < FRESH_MS) return;
        if (!force && Date.now() - lastFailure < RETRY_MS) return;
        fetching = true;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url(), true);
        xhr.timeout = TIMEOUT_MS;
        xhr.onload = function () {
            var ok = false;
            try {
                ok = xhr.status >= 200 && xhr.status < 300 && accept(JSON.parse(xhr.responseText));
            } catch (e) {
                ok = false;
            }
            if (ok) {
                fetching = false;
                lastFailure = 0;
            } else {
                failed('unusable response (HTTP ' + xhr.status + ')');
            }
        };
        xhr.onerror = function () { failed('request failed'); };
        xhr.ontimeout = function () { failed('request timed out'); };
        xhr.send();
    }

    function applySettings() {
        clearReading();
        lastFailure = 0;
        if (configured()) refresh(true);
    }

    function start() {
        load();
        if (!configured()) {
            DevLog.log('Weather off: pick a place in Settings → Weather');
            return;
        }
        refresh();
    }

    function summary() {
        var p = prefsWeather();
        if (!configured()) return 'Off';
        return placeLabel() + ' · ' + (p.unit === 'fahrenheit' ? '°F' : '°C');
    }

    window.Weather = {
        seedFromConfig: seedFromConfig,
        resolvePlace: resolvePlace,
        detectLocation: detectLocation,
        searchPlaces: searchPlaces,
        placeLabel: placeLabel,
        start: start,
        refresh: refresh,
        applySettings: applySettings,
        current: current,
        configured: configured,
        summary: summary,
        icon: icon,
        group: group,
        onUpdate: function (fn) { listeners.push(fn); },
        actions: function () {
            return [{
                label: 'Weather: fetch now and log the reading',
                run: function () {
                    if (!configured()) {
                        UI.toast('Weather is off — pick a place in Settings');
                        return;
                    }
                    DevLog.log('Weather: requesting ' + url());
                    var once = function () {
                        DevLog.log('Weather: ' + JSON.stringify(reading));
                        UI.toast('Weather updated');
                    };
                    listeners.push(once);
                    refresh(true);
                }
            }];
        }
    };
})();
