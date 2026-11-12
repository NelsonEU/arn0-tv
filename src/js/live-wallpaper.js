/*
 * Live wallpapers from Bing's daily image archive.
 *
 * Metadata only in localStorage (url, title, credit, date key) — never image bytes.
 * Pool length is capped at liveWallpaper.max (default 7). Once a day, today's image is
 * prepended and the oldest dropped so the count stays consistent.
 */
(function () {
    'use strict';

    var CACHE_KEY = 'arn0.liveWallpaper.v1';
    var TIMEOUT_MS = 10000;
    var BING = 'https://www.bing.com';

    var items = [];
    var fetchedDay = '';
    var fetching = false;
    var lastFailure = 0;
    var RETRY_MS = 5 * 60 * 1000;

    function cfg() {
        var c = (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.liveWallpaper) || {};
        return {
            market: c.market || 'en-GB',
            max: Math.max(1, Math.min(15, c.max || 15))
        };
    }

    function max() { return cfg().max; }
    var cachedMarket = '';

    function todayKey() {
        var d = new Date();
        return d.getFullYear() + '-' +
            ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            ('0' + d.getDate()).slice(-2);
    }

    function loadCache() {
        try {
            var raw = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (!raw || !Array.isArray(raw.items)) return;
            // Drop the pool if the Bing market changed (or cache predates market tracking).
            if (raw.market !== cfg().market) {
                items = [];
                fetchedDay = '';
                cachedMarket = '';
                return;
            }
            fetchedDay = raw.fetchedDay || '';
            cachedMarket = raw.market || '';
            items = raw.items.slice(0, max()).map(normalize);
        } catch (e) {
            items = [];
            fetchedDay = '';
            cachedMarket = '';
        }
    }

    function saveCache() {
        try {
            cachedMarket = cfg().market;
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                fetchedDay: fetchedDay,
                market: cachedMarket,
                items: items
            }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save cache');
        }
    }

    function normalize(entry) {
        return {
            key: entry.key,
            title: entry.title || 'Bing daily',
            file: entry.file,
            thumb: entry.thumb || entry.file,
            credit: entry.credit || '',
            remote: true
        };
    }

    function parseBingImage(img) {
        var base = img.urlbase || (img.url ? img.url.replace(/\?.*/, '') : '');
        if (!base) return null;
        var file = BING + base + '_1920x1080.jpg';
        var thumb = BING + base + '_320x180.jpg';
        var title = img.title || (img.copyright || '').split('(')[0].trim() || 'Bing daily';
        var credit = img.copyright || 'Bing';
        return normalize({
            key: String(img.startdate || title),
            title: title,
            file: file,
            thumb: thumb,
            credit: credit
        });
    }

    function archiveUrl(idx, n) {
        return BING + '/HPImageArchive.aspx?format=js&idx=' + idx +
            '&n=' + n + '&mkt=' + encodeURIComponent(cfg().market);
    }

    function xhrGet(url) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = TIMEOUT_MS;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else {
                    reject(new Error('HTTP ' + xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send();
        });
    }

    // Preview: Bing JSON is CORS-blocked in Chrome. Stable Picsum ids, metadata only.
    function mockFill() {
        var seeds = [1015, 1018, 1022, 1036, 1043, 1050, 1069, 1074, 1084, 110];
        var n = max();
        items = [];
        for (var i = 0; i < n; i++) {
            var id = seeds[i % seeds.length];
            items.push(normalize({
                key: 'mock-' + id,
                title: 'Online sample ' + (i + 1),
                file: 'https://picsum.photos/id/' + id + '/1920/1080',
                thumb: 'https://picsum.photos/id/' + id + '/320/180',
                credit: 'Picsum (preview)'
            }));
        }
        fetchedDay = todayKey();
        saveCache();
        return items;
    }

    function trim() {
        if (items.length > max()) items = items.slice(0, max());
    }

    function mergeToday(entry) {
        items = items.filter(function (w) { return w.key !== entry.key; });
        items.unshift(entry);
        trim();
    }

    // Bing accepts n ≤ 8 per call; page with idx to fill up to max (15).
    function fillFromArchive() {
        var need = max();
        var collected = [];
        var seen = {};

        function page(idx) {
            var n = Math.min(8, need - collected.length);
            if (n <= 0 || idx > 14) {
                if (!collected.length) throw new Error('empty archive');
                items = collected.slice(0, need);
                fetchedDay = todayKey();
                lastFailure = 0;
                saveCache();
                DevLog.log('Live wallpaper: filled ' + items.length + ' / max ' + need);
                return true;
            }
            return xhrGet(archiveUrl(idx, n)).then(function (data) {
                var batch = (data.images || []).map(parseBingImage).filter(Boolean);
                batch.forEach(function (entry) {
                    if (seen[entry.key] || collected.length >= need) return;
                    seen[entry.key] = true;
                    collected.push(entry);
                });
                if (!batch.length) return page(99);
                return page(idx + batch.length);
            });
        }

        return page(0);
    }

    function topUpToday() {
        return xhrGet(archiveUrl(0, 1)).then(function (data) {
            var entry = parseBingImage((data.images || [])[0]);
            if (!entry) throw new Error('no today image');
            mergeToday(entry);
            fetchedDay = todayKey();
            lastFailure = 0;
            saveCache();
            DevLog.log('Live wallpaper: daily top-up ' + entry.key + ' (' + items.length + '/' + max() + ')');
            return true;
        });
    }

    /*
     * Ensures the pool is ready and today's image is included when the calendar day changed.
     * Resolves to true if the list changed.
     */
    function ensureDaily() {
        if (fetching) return Promise.resolve(false);
        if (window.__TIZEN_MOCK__) {
            if (!items.length || fetchedDay !== todayKey()) {
                mockFill();
                return Promise.resolve(true);
            }
            return Promise.resolve(false);
        }
        if (Date.now() - lastFailure < RETRY_MS) return Promise.resolve(false);

        fetching = true;
        var before = items.map(function (w) { return w.key; }).join(',');
        var work = !items.length ? fillFromArchive()
            : (fetchedDay !== todayKey() ? topUpToday() : Promise.resolve(false));

        return work.then(function () {
            fetching = false;
            var after = items.map(function (w) { return w.key; }).join(',');
            return before !== after;
        }).catch(function (e) {
            fetching = false;
            lastFailure = Date.now();
            DevLog.log('Live wallpaper: ' + (e && e.message ? e.message : e));
            return false;
        });
    }

    function list() { return items.slice(); }

    function find(key) {
        return items.find(function (w) { return w.key === key; }) || items[0] || null;
    }

    function clearCache() {
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        items = [];
        fetchedDay = '';
        cachedMarket = '';
    }

    loadCache();
    trim();
    if (items.length) saveCache();

    window.LiveWallpaper = {
        max: max,
        list: list,
        find: find,
        ensureDaily: ensureDaily,
        clearCache: clearCache,
        fetchedDay: function () { return fetchedDay; }
    };
})();
