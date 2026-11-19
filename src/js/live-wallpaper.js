/*
 * Live wallpapers: Bing (no key), NASA APOD (apod.nasa.gov pages, no key), Wikimedia Picture of
 * the Day (no key), Unsplash (Access Key), Immich shared album, or Mix (all ready sources).
 *
 * Metadata only in localStorage (url, title, credit, date key) — never image bytes.
 *
 * First photo shows as soon as one source returns; an upcoming playlist (~15) fills in the
 * background. Image bytes still load only when a photo's turn arrives. Mix picks sources
 * round-robin, or at random when Shuffle is on. Immich walks the album page by page (Shuffle
 * picks a random unused asset from each page). Recent history is kept for the screen saver
 * fallback.
 *
 * NASA APOD: science.nasa.gov WordPress image-article + media API (the old apod.nasa.gov
 * apYYMMDD.html pages and api.nasa.gov DEMO_KEY now return shells / logo placeholders).
 *
 * Unsplash Access Key: Settings → Background (saved on the TV). liveWallpaper.unsplashAccessKey
 * in config.local.js is used as a fallback when nothing has been saved. Stored separately so
 * Advanced → Export does not dump it.
 *
 * Browser preview (`npm run preview`) routes API calls through /api/live/* so Chrome
 * CORS does not block fetches; on the TV the real endpoints are used directly.
 */
(function () {
    'use strict';

    var CACHE_KEY = 'arn0.liveWallpaper.v7';
    var IMMICH_STORE = 'arn0.immich.v1';
    var UNSPLASH_KEY_STORE = 'arn0.unsplash.v1';
    var TIMEOUT_MS = 15000;
    var BING = 'https://www.bing.com';
    var UNSPLASH = 'https://api.unsplash.com';
    var NASA_CHUNK = 5;
    var NASA_EXTRA_DAYS = 180;
    var WIKIMEDIA_EXTRA_DAYS = 20;
    var UNSPLASH_PER_PAGE = 30;
    var UNSPLASH_PAGES = 50;
    var IMMICH_MAX = 200;
    var IMMICH_PAGE = 100;
    // Planned upcoming list + recent history; one fetch at a time; short skip timeout.
    var HISTORY_MAX = 40;
    var PLAN_SIZE = 15;
    var SOURCE_MS = 12 * 1000;
    // Immich is on the LAN but often colder on first hit (share + search); give it room.
    var IMMICH_SOURCE_MS = 45 * 1000;
    var IMMICH_XHR_MS = 40 * 1000;
    var IMMICH_BUF_SIZE = 12;
    var RETRY_MS = 5 * 60 * 1000;
    var RATE_LIMIT_MS = 60 * 60 * 1000;
    var FETCH_LIMIT_MS = 90 * 1000;

    var PROVIDERS = [
        { key: 'bing', label: 'Bing', needsKey: false },
        { key: 'nasa', label: 'NASA APOD', needsKey: false },
        { key: 'wikimedia', label: 'Wikimedia POTD', needsKey: false },
        { key: 'unsplash', label: 'Unsplash', needsKey: true },
        { key: 'immich', label: 'Immich album', needsKey: true },
        { key: 'mix', label: 'Mix', needsKey: false }
    ];

    var items = [];
    var fetchedDay = '';
    var cachedProvider = '';
    var cachedMarket = '';
    var fetching = false;
    var lastFailure = 0;
    var retryDelay = RETRY_MS;
    var lastError = '';
    // Bumped whenever the pool is reset, so in-flight fetches for an old source are discarded.
    var generation = 0;
    var unsplashKey = '';
    var unsplashCollection = '';
    var listeners = [];

    function notify() {
        listeners.forEach(function (fn) { fn(); });
    }

    function cfg() {
        var c = (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.liveWallpaper) || {};
        return {
            market: c.market || 'en-GB',
            max: Math.max(1, Math.min(50, c.max || 50)),
            unsplashAccessKey: c.unsplashAccessKey || '',
            immichLink: c.immichLink || '',
            unsplashCollection: c.unsplashCollection || ''
        };
    }

    function max() { return cfg().max; }

    function poolLimit() { return PLAN_SIZE; }

    // Live always uses a planned upcoming list (images still decode on their turn).
    function isOnDemand() { return true; }

    function shuffleOn() {
        return !!(window.Prefs && Prefs.get().wallpaper.random);
    }

    function shuffleInPlace(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return arr;
    }

    // Sequential counter, or a random offset in [0, span) when Shuffle is on.
    function nextOffset(name, span) {
        if (!shuffleOn()) return stream[name]++;
        return Math.floor(Math.random() * span);
    }

    function provider() {
        var p = window.Prefs && Prefs.get().wallpaper;
        var key = (p && p.liveProvider) || 'bing';
        return PROVIDERS.some(function (x) { return x.key === key; }) ? key : 'bing';
    }

    function providerMeta() {
        return PROVIDERS.find(function (x) { return x.key === provider(); }) || PROVIDERS[0];
    }

    function dayKey(d) {
        return d.getFullYear() + '-' +
            ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            ('0' + d.getDate()).slice(-2);
    }

    function todayKey() { return dayKey(new Date()); }

    function daysAgoKey(n) {
        var d = new Date();
        d.setDate(d.getDate() - n);
        return dayKey(d);
    }

    function readUnsplashStore() {
        var raw = null;
        try { raw = JSON.parse(localStorage.getItem(UNSPLASH_KEY_STORE)); } catch (e) { /* ignore */ }
        raw = raw || {};
        return {
            accessKey: typeof raw.accessKey === 'string' ? raw.accessKey : (cfg().unsplashAccessKey || ''),
            collection: typeof raw.collection === 'string' ? raw.collection : (cfg().unsplashCollection || '')
        };
    }

    function saveUnsplashStore() {
        try {
            localStorage.setItem(UNSPLASH_KEY_STORE, JSON.stringify({
                accessKey: unsplashKey,
                collection: unsplashCollection
            }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save Unsplash settings');
        }
    }

    function setUnsplashKey(key) {
        unsplashKey = String(key || '').trim();
        saveUnsplashStore();
    }

    function setUnsplashCollection(id) {
        unsplashCollection = String(id || '').trim();
        saveUnsplashStore();
    }

    function clearUnsplashKey() {
        try { localStorage.removeItem(UNSPLASH_KEY_STORE); } catch (e) { /* ignore */ }
        applyUnsplashStore();
    }

    function applyUnsplashStore() {
        var s = readUnsplashStore();
        unsplashKey = s.accessKey;
        unsplashCollection = s.collection;
    }

    var immichLink = '';

    // Share link as pasted: https://host[/prefix]/s/SLUG or https://host[/prefix]/share/KEY.
    function parseImmichLink(link) {
        var m = String(link || '').trim().match(/^(https?:\/\/.+?)\/(s|share)\/([A-Za-z0-9_-]+)\/?$/);
        if (!m) return null;
        return { origin: m[1], query: (m[2] === 's' ? 'slug=' : 'key=') + encodeURIComponent(m[3]) };
    }

    function readImmichLink() {
        try {
            var raw = JSON.parse(localStorage.getItem(IMMICH_STORE));
            if (raw && typeof raw.link === 'string') return raw.link;
        } catch (e) { /* ignore */ }
        return cfg().immichLink || '';
    }

    function setImmichLink(link) {
        immichLink = String(link || '').trim();
        try {
            localStorage.setItem(IMMICH_STORE, JSON.stringify({ link: immichLink }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save Immich link');
        }
    }

    function clearImmichLink() {
        try { localStorage.removeItem(IMMICH_STORE); } catch (e) { /* ignore */ }
        immichLink = readImmichLink();
    }

    function immichConfigured() {
        return !!parseImmichLink(immichLink);
    }

    function providerConfigured() {
        var p = provider();
        if (p === 'unsplash') return unsplashConfigured();
        if (p === 'immich') return immichConfigured();
        return true;
    }

    function needsSetup() {
        return providerMeta().needsKey && !providerConfigured();
    }

    function unsplashConfigured() {
        return !!unsplashKey;
    }

    function resetStream() {
        stream = {
            sourceIndex: 0,
            bing: 0,
            nasa: 0,
            wiki: 0,
            unsplash: 0,
            immich: 1,
            immichBuf: [],
            immichAlbum: null,
            immichFilling: null,
            immichExhausted: false,
            plan: [],
            filling: null
        };
    }

    var stream;
    resetStream();

    function resetPool() {
        items = [];
        fetchedDay = '';
        cachedProvider = '';
        cachedMarket = '';
        resetStream();
    }

    function loadCache() {
        try {
            var raw = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (!raw || !Array.isArray(raw.items)) return;
            if (raw.provider !== provider()) return;
            if (raw.provider === 'bing' && raw.market !== cfg().market) return;
            fetchedDay = raw.fetchedDay || '';
            cachedProvider = raw.provider;
            cachedMarket = raw.market || '';
            items = raw.items.slice(0, poolLimit()).map(normalize);
        } catch (e) {
            resetPool();
        }
    }

    // `p` is the provider the items were fetched from, not the one currently selected.
    function saveCache(p) {
        cachedProvider = p;
        cachedMarket = cfg().market;
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                provider: p,
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
            title: entry.title != null ? entry.title : 'Live wallpaper',
            sub: entry.sub || '',
            file: entry.file,
            fileFallback: entry.fileFallback || '',
            fileFallbacks: entry.fileFallbacks || [],
            thumb: entry.thumb || entry.file,
            credit: entry.credit || '',
            trackUrl: entry.trackUrl || '',
            remote: true
        };
    }

    function keys(list) {
        return list.map(function (w) { return w.key; }).join(',');
    }

    function trim() {
        var lim = poolLimit();
        if (items.length > lim) items = items.slice(0, lim);
    }

    function mergeToday(entry) {
        items = items.filter(function (w) { return w.key !== entry.key; });
        items.unshift(entry);
        trim();
    }

    function httpError(status) {
        var e = new Error('HTTP ' + status);
        e.status = status;
        return e;
    }

    function xhrGet(url, headers, asText, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = timeoutMs || TIMEOUT_MS;
            if (headers) {
                Object.keys(headers).forEach(function (h) {
                    xhr.setRequestHeader(h, headers[h]);
                });
            }
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (asText) {
                        resolve(xhr.responseText);
                        return;
                    }
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else {
                    reject(httpError(xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send();
        });
    }

    // Browser preview: same-origin proxy in scripts/serve.mjs (Chrome CORS blocks the APIs).
    function preview() { return !!window.__TIZEN_MOCK__; }

    /* ---------- Bing ---------- */

    function parseBingImage(img) {
        if (!img) return null;
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

    function bingArchiveUrl(idx, n) {
        var query = 'idx=' + idx + '&n=' + n + '&mkt=' + encodeURIComponent(cfg().market);
        if (preview()) return '/api/live/bing?' + query;
        return BING + '/HPImageArchive.aspx?format=js&' + query;
    }

    // Bing accepts n ≤ 8 per call; page with idx to fill up to need (default max).
    function fetchBingPool(needCount) {
        var need = needCount != null ? needCount : max();
        var collected = [];
        var seen = {};

        function page(idx) {
            var n = Math.min(8, need - collected.length);
            if (n <= 0 || idx > 64) {
                if (!collected.length) return Promise.reject(new Error('empty archive'));
                return Promise.resolve(collected);
            }
            return xhrGet(bingArchiveUrl(idx, n)).then(function (data) {
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

    function fetchBingToday() {
        return xhrGet(bingArchiveUrl(0, 1)).then(function (data) {
            var entry = parseBingImage((data.images || [])[0]);
            if (!entry) throw new Error('no today image');
            return entry;
        });
    }

    /* ---------- NASA APOD ---------- */

    function decodeEntities(s) {
        return String(s || '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#8211;/g, '\u2013')
            .replace(/&#(\d+);/g, function (_, n) {
                return String.fromCharCode(Number(n));
            });
    }

    function nasaFileOk(file) {
        if (!file || file.length < 12) return false;
        return !/nasa-logo|favicon|themes\/nasa-child|editor-page-nasa-logo/i.test(file);
    }

    var APOD_MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // WP titles look like "APOD: 2026 November 9 – Title" (no leading zero on the day).
    function apodSearchQuery(ymd) {
        var p = ymd.split('-');
        return 'APOD: ' + p[0] + ' ' + APOD_MONTHS[Number(p[1]) - 1] + ' ' + String(Number(p[2]));
    }

    function apodTitleOk(rendered, ymd) {
        var t = decodeEntities(String(rendered || '')).toLowerCase();
        var want = apodSearchQuery(ymd).toLowerCase();
        return t.indexOf(want) === 0;
    }

    function apodCleanTitle(rendered) {
        var title = decodeEntities(String(rendered || ''));
        title = title.replace(/^APOD:\s*/i, '')
            .replace(/^\d{4} [A-Za-z]+ \d{1,2}\s*[–\-]\s*/, '')
            .replace(/\s*-\s*NASA Science\s*$/i, '')
            .trim();
        return title || 'NASA APOD';
    }

    function apodImageFromMedia(media) {
        var sizes = (media && media.media_details && media.media_details.sizes) || {};
        var pick = sizes['2048x2048'] || sizes.large || sizes['1536x1536'] || sizes.medium_large;
        var file = (pick && pick.source_url) || (media && media.source_url) || '';
        var thumb = (sizes.medium && sizes.medium.source_url) ||
            (sizes.thumbnail && sizes.thumbnail.source_url) || file;
        return { file: file, thumb: thumb };
    }

    function apodFromWp(post, media, ymd) {
        if (!post || !apodTitleOk(post.title && post.title.rendered, ymd)) return null;
        var img = apodImageFromMedia(media);
        if (!nasaFileOk(img.file)) return null;
        return normalize({
            key: 'nasa:' + ymd,
            title: apodCleanTitle(post.title && post.title.rendered),
            file: img.file,
            thumb: img.thumb || img.file,
            credit: 'NASA APOD'
        });
    }

    function fetchNasaDayWp(ymd) {
        var search = 'https://science.nasa.gov/wp-json/wp/v2/image-article?search=' +
            encodeURIComponent(apodSearchQuery(ymd)) + '&per_page=5';
        return xhrGet(search).then(function (list) {
            var post = (Array.isArray(list) ? list : []).find(function (p) {
                return apodTitleOk(p.title && p.title.rendered, ymd);
            });
            if (!post || !post.featured_media) throw new Error('empty NASA');
            return xhrGet('https://science.nasa.gov/wp-json/wp/v2/media/' + post.featured_media)
                .then(function (media) {
                    var entry = apodFromWp(post, media, ymd);
                    if (!entry) throw new Error('empty NASA');
                    return entry;
                });
        });
    }

    function fetchNasaDay(ymd) {
        // Preview: one proxied call returns the normalized entry (Chrome CORS).
        if (preview()) {
            return xhrGet('/api/live/apod?date=' + encodeURIComponent(ymd)).then(function (data) {
                if (!data || !data.file || !nasaFileOk(data.file)) throw new Error('empty NASA');
                return normalize(data);
            });
        }
        return fetchNasaDayWp(ymd);
    }

    // Fetches days back from today in parallel chunks until `need` entries are collected.
    // Extra days cover missing / video / placeholder days.
    function collectDays(fetchDay, need, extraDays) {
        var limit = need + extraDays;
        var collected = [];
        var seen = {};

        function chunk(from) {
            if (collected.length >= need || from >= limit) {
                if (!collected.length) return Promise.reject(new Error('no images found'));
                return Promise.resolve(collected.slice(0, need));
            }
            var days = [];
            for (var d = from; d < Math.min(from + NASA_CHUNK, limit); d++) {
                days.push(daysAgoKey(d));
            }
            return Promise.all(days.map(function (ymd) {
                return fetchDay(ymd).catch(function () { return null; });
            })).then(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry || seen[entry.file] || collected.length >= need) return;
                    seen[entry.file] = true;
                    collected.push(entry);
                });
                return chunk(from + NASA_CHUNK);
            });
        }

        return chunk(0);
    }

    function fetchNasaPool(needCount) {
        return collectDays(fetchNasaDay, needCount != null ? needCount : max(), NASA_EXTRA_DAYS);
    }

    // Video days resolve to null; the day is still marked as checked.
    function fetchNasaToday() {
        return fetchNasaDay(todayKey());
    }

    /* ---------- Wikimedia Picture of the Day ---------- */

    // Feed image: thumbnail is ~960px, the original can be 5000px+. Ask the thumbnail
    // service for a sized version of the same file instead.
    function wikimediaSized(src, width) {
        var clean = src.split('?')[0];
        var m = clean.match(/^(.*\/thumb\/.+\/)\d+px-([^/]+)$/);
        return m ? m[1] + width + 'px-' + m[2] : clean;
    }

    function parseWikimediaPotd(data, ymd) {
        var img = data && data.image;
        if (!img || !img.thumbnail || !img.thumbnail.source) return null;
        var title = String(img.title || '')
            .replace(/^File:/, '')
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/_/g, ' ');
        var artist = (img.artist && img.artist.text) || '';
        return normalize({
            key: 'wikimedia:' + ymd,
            title: title || 'Picture of the day',
            file: wikimediaSized(img.thumbnail.source, 1920),
            thumb: wikimediaSized(img.thumbnail.source, 480),
            credit: 'Wikimedia Commons' + (artist ? ' · ' + artist : '')
        });
    }

    function fetchWikimediaDay(ymd) {
        var p = ymd.split('-');
        var url = 'https://en.wikipedia.org/api/rest_v1/feed/featured/' + p[0] + '/' + p[1] + '/' + p[2];
        return xhrGet(url).then(function (data) {
            return parseWikimediaPotd(data, ymd);
        });
    }

    function fetchWikimediaPool(needCount) {
        return collectDays(fetchWikimediaDay, needCount != null ? needCount : max(), WIKIMEDIA_EXTRA_DAYS);
    }

    function fetchWikimediaToday() {
        return fetchWikimediaDay(todayKey());
    }

    /* ---------- Unsplash ---------- */

    function unsplashApi(path) {
        return preview() ? '/api/live/unsplash?path=' + encodeURIComponent(path) : UNSPLASH + path;
    }

    function unsplashGet(path) {
        return xhrGet(unsplashApi(path), { Authorization: 'Client-ID ' + unsplashKey });
    }

    // Unsplash has no photo-of-the-day endpoint. Each local calendar day maps to a fixed
    // slot in a fixed ordering (a collection, or popular photos), so a day always shows the
    // same photo, also after a restart. Pages cycle after UNSPLASH_PAGES to stay in range.
    function dayNumber(d) {
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    }

    function unsplashPhotosPath(page) {
        var c = unsplashCollection;
        var query = 'per_page=' + UNSPLASH_PER_PAGE + '&page=' + page;
        if (c) return '/collections/' + encodeURIComponent(c) + '/photos?' + query;
        return '/photos?order_by=popular&' + query;
    }

    function fetchUnsplashDays(offsets) {
        var today = dayNumber(new Date());
        var slots = offsets.map(function (o) {
            var g = today - o;
            return {
                page: Math.floor(g / UNSPLASH_PER_PAGE) % UNSPLASH_PAGES + 1,
                index: g % UNSPLASH_PER_PAGE
            };
        });
        var pages = {};
        slots.forEach(function (s) { pages[s.page] = []; });
        return Promise.all(Object.keys(pages).map(function (p) {
            return unsplashGet(unsplashPhotosPath(p)).then(function (data) {
                pages[p] = parseUnsplashList(data);
            });
        })).then(function () {
            return slots.map(function (s) {
                var list = pages[s.page];
                return list.length ? list[s.index % list.length] : null;
            }).filter(Boolean);
        });
    }

    function range(n) {
        var out = [];
        for (var i = 0; i < n; i++) out.push(i);
        return out;
    }

    function parseUnsplashImage(img) {
        if (!img || !img.urls || !img.urls.raw) return null;
        // Size the raw URL for a 1080p panel; the API's regular/full URLs are fixed-size.
        var raw = img.urls.raw;
        var file = raw + (raw.indexOf('?') === -1 ? '?' : '&') +
            'w=1920&fit=max&q=85&auto=format';
        var title = img.alt_description || img.description || 'Unsplash';
        if (title.length > 48) title = title.slice(0, 45) + '…';
        var credit = (img.user && img.user.name) ? (img.user.name + ' on Unsplash') : 'Unsplash';
        return normalize({
            key: String(img.id || title),
            title: title,
            file: file,
            thumb: img.urls.small || file,
            credit: credit,
            trackUrl: (img.links && img.links.download_location) || ''
        });
    }

    function parseUnsplashList(data) {
        var list = Array.isArray(data) ? data : (data ? [data] : []);
        return list.map(parseUnsplashImage).filter(Boolean);
    }

    function fetchUnsplashPool(needCount) {
        var n = needCount != null ? needCount : max();
        return fetchUnsplashDays(range(n)).then(function (list) {
            var seen = {};
            list = list.filter(function (e) {
                if (seen[e.key]) return false;
                seen[e.key] = true;
                return true;
            });
            if (!list.length) throw new Error('empty Unsplash');
            return list;
        });
    }

    function fetchUnsplashToday() {
        return fetchUnsplashDays([0]).then(function (list) {
            if (!list[0]) throw new Error('no Unsplash image');
            return list[0];
        });
    }

    // Unsplash API guidelines: report each photo the app actually shows.
    function trackUnsplash(entries) {
        entries.forEach(function (entry) {
            if (!entry.trackUrl || entry.trackUrl.indexOf(UNSPLASH) !== 0) return;
            xhrGet(unsplashApi(entry.trackUrl.slice(UNSPLASH.length)), { Authorization: 'Client-ID ' + unsplashKey })
                .catch(function (e) {
                    DevLog.log('Live wallpaper: Unsplash download ping failed: ' + e.message);
                });
        });
    }

    /* ---------- Immich (shared album link) ---------- */

    function immichApi(path) {
        var s = parseImmichLink(immichLink);
        var url = s.origin + '/api' + path;
        return preview() ? '/api/live/immich?url=' + encodeURIComponent(url) : url;
    }

    function xhrPostJson(url, body, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.timeout = timeoutMs || TIMEOUT_MS;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else {
                    reject(httpError(xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send(JSON.stringify(body));
        });
    }

    function fetchImmichLinkData() {
        var s = parseImmichLink(immichLink);
        if (!s) return Promise.reject(new Error('Immich share link required'));
        return xhrGet(immichApi('/shared-links/me?' + s.query), null, false, IMMICH_XHR_MS);
    }

    // Camera roll dumps (IMG_1234, PXL_…, DSC…) are not useful captions.
    function isDumpFilename(name) {
        return /^(IMG[_-]?|DSC[_N]?|DCIM|PXL_|MVIMG_|VID_|Screenshot|PHOTO[_-]?|PIC[_-]?|image[_-]?|WA\d)/i.test(name) ||
            /^\d{8}[_-]\d{6}/.test(name);
    }

    function immichExif(a) {
        return (a && a.exifInfo) || {};
    }

    // Immich reverse-geocode fields; countryCode is a fallback on older/partial EXIF.
    function immichPlace(a) {
        var x = immichExif(a);
        return [x.city, x.state, x.country || x.countryCode].filter(Boolean).join(', ');
    }

    function immichTitle(a, album) {
        var x = immichExif(a);
        var desc = String(x.description || a.description || '').trim();
        if (desc) return desc.length > 120 ? desc.slice(0, 117) + '…' : desc;
        var place = immichPlace(a);
        if (place) return place;
        var name = String(a.originalFileName || '').split(/[/\\]/).pop() || '';
        name = name.replace(/\.[a-z0-9]+$/i, '');
        if (name && !isDumpFilename(name)) return name;
        if (album) return album;
        return 'Immich';
    }

    function immichDate(a) {
        // localDateTime is the wall-clock time where the photo was taken; reading its date part
        // avoids shifting the day through the TV's own timezone.
        var x = immichExif(a);
        var m = String(a.localDateTime || x.dateTimeOriginal || a.fileCreatedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        var when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function immichEntry(a, origin, query, album) {
        var base = origin + '/api/assets/' + encodeURIComponent(a.id);
        var q = '&' + query;
        var place = immichPlace(a);
        var title = immichTitle(a, album);
        var date = immichDate(a);
        // Prefer place on the title line; keep date (+ album via credit) underneath.
        var sub = date;
        if (place && title !== place && title.indexOf(place) !== 0) {
            sub = place + (date ? ' · ' + date : '');
        }
        var original = base + '/original?' + query;
        var fullsize = base + '/thumbnail?size=fullsize' + q;
        var preview = base + '/thumbnail?size=preview' + q;
        return normalize({
            key: a.id,
            title: title,
            sub: sub,
            // Share links often block /original unless "Allow download" is on; fullsize may be
            // unpublished. Display probes original → fullsize → preview.
            file: original,
            fileFallback: fullsize,
            fileFallbacks: [fullsize, preview],
            thumb: preview,
            credit: album ? 'Immich · ' + album : 'Immich'
        });
    }

    function fetchImmichAsset(id) {
        var s = parseImmichLink(immichLink);
        return xhrGet(immichApi('/assets/' + encodeURIComponent(id) + '?' + s.query), null, false, IMMICH_XHR_MS);
    }

    // Search hits often omit reverse-geocoded place; the asset endpoint usually has full EXIF.
    function mergeImmichAsset(searchHit, full) {
        if (!full) return searchHit;
        var merged = {};
        Object.keys(searchHit || {}).forEach(function (k) { merged[k] = searchHit[k]; });
        Object.keys(full).forEach(function (k) { merged[k] = full[k]; });
        merged.exifInfo = Object.assign({}, immichExif(searchHit), immichExif(full));
        if (!merged.localDateTime && searchHit.localDateTime) merged.localDateTime = searchHit.localDateTime;
        return merged;
    }

    // Shared link does not list album contents; assets come from search, paginated.
    function fetchImmichAlbum(limit) {
        var cap = limit != null ? limit : IMMICH_MAX;
        return fetchImmichLinkData().then(function (link) {
            var s = parseImmichLink(immichLink);
            var album = (link.album && link.album.albumName) || '';
            if (!link.album || !link.album.id) throw new Error('Immich link is not an album');
            var collected = [];
            var seen = {};
            var pageSize = Math.min(IMMICH_PAGE, Math.max(cap, 1));

            function page(pageNum) {
                return xhrPostJson(immichApi('/search/metadata?' + s.query), {
                    albumIds: [link.album.id],
                    type: 'IMAGE',
                    size: pageSize,
                    page: pageNum,
                    withExif: true
                }).then(function (res) {
                    var batch = ((res.assets && res.assets.items) || []).filter(function (a) {
                        return a.type === 'IMAGE';
                    });
                    batch.forEach(function (a) {
                        if (seen[a.id] || collected.length >= cap) return;
                        seen[a.id] = true;
                        collected.push(immichEntry(a, s.origin, s.query, album));
                    });
                    if (!batch.length || batch.length < pageSize || collected.length >= cap) {
                        if (!collected.length) throw new Error('empty Immich album');
                        return collected;
                    }
                    return page(pageNum + 1);
                });
            }

            return page(1);
        });
    }

    function fetchImmichPool(limit) {
        return fetchImmichAlbum(limit);
    }

    // Immich and Mix re-sync the whole pool on a calendar day change (see ensureDaily).
    function fetchImmichToday() {
        return fetchImmichAlbum().then(function (list) { return list[0] || null; });
    }

    /* ---------- On-demand (one photo at a time, all providers) ---------- */

    function readyMixKeys() {
        var keys = ['bing', 'nasa', 'wikimedia'];
        if (unsplashConfigured()) keys.push('unsplash');
        if (immichConfigured()) keys.push('immich');
        return keys;
    }

    function streamKeys() {
        var p = provider();
        if (p === 'mix') return readyMixKeys();
        if (p === 'unsplash') return unsplashConfigured() ? ['unsplash'] : [];
        if (p === 'immich') return immichConfigured() ? ['immich'] : [];
        return [p];
    }

    function mixSourceLabels() {
        return readyMixKeys().map(function (k) {
            var meta = PROVIDERS.find(function (x) { return x.key === k; });
            return meta ? meta.label : k;
        });
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(new Error('timeout'));
            }, ms);
            promise.then(function (value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }, function (err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    function setLiveKey(key) {
        if (!key || !window.Prefs) return;
        var w = Prefs.get().wallpaper;
        if (w.liveKey === key) return;
        w.liveKey = key;
        w.lastChange = Date.now();
        Prefs.save();
    }

    function ensureImmichAlbum() {
        if (stream.immichAlbum) return Promise.resolve(stream.immichAlbum);
        return fetchImmichLinkData().then(function (link) {
            var s = parseImmichLink(immichLink);
            if (!link.album || !link.album.id) throw new Error('Immich link is not an album');
            stream.immichAlbum = {
                id: link.album.id,
                name: (link.album && link.album.albumName) || '',
                origin: s.origin,
                query: s.query
            };
            return stream.immichAlbum;
        });
    }

    // Buffer a page of new Immich assets (skip ids already planned/shown).
    function fillImmichBuf() {
        if (stream.immichFilling) return stream.immichFilling;
        if (stream.immichExhausted) return Promise.reject(new Error('Immich album exhausted'));

        stream.immichFilling = ensureImmichAlbum().then(function (album) {
            var guard = 0;

            function page() {
                if (guard++ > 40) {
                    stream.immichExhausted = true;
                    throw new Error('Immich album exhausted');
                }
                var pageNum = stream.immich;
                return xhrPostJson(immichApi('/search/metadata?' + album.query), {
                    albumIds: [album.id],
                    type: 'IMAGE',
                    size: IMMICH_BUF_SIZE,
                    page: pageNum,
                    withExif: true
                }, IMMICH_XHR_MS).then(function (res) {
                    var batch = ((res.assets && res.assets.items) || []).filter(function (a) {
                        return a.type === 'IMAGE';
                    });
                    if (!batch.length) {
                        if (pageNum <= 1) throw new Error('empty Immich album');
                        stream.immichExhausted = true;
                        throw new Error('Immich album exhausted');
                    }
                    stream.immich = pageNum + 1;
                    var seen = knownKeys();
                    var fresh = batch.filter(function (a) { return !seen[a.id]; });
                    if (!fresh.length) return page();
                    if (shuffleOn()) shuffleInPlace(fresh);
                    fresh.forEach(function (a) { stream.immichBuf.push(a); });
                    if (shuffleOn()) shuffleInPlace(stream.immichBuf);
                });
            }

            return page();
        }).then(function () {
            stream.immichFilling = null;
        }, function (err) {
            stream.immichFilling = null;
            throw err;
        });

        return stream.immichFilling;
    }

    // Warm the Immich buffer in parallel; Mix Immich slots then shift locally.
    function warmImmich() {
        if (!immichConfigured()) return Promise.resolve();
        if (stream.immichBuf.length || stream.immichExhausted) return Promise.resolve();
        return fillImmichBuf().then(function () {
            DevLog.log('Live wallpaper: Immich buffer ' + stream.immichBuf.length);
        }, function (e) {
            DevLog.log('Live wallpaper: Immich warm failed: ' + (e && e.message ? e.message : e));
        });
    }

    // Fast path for planning / first paint: search EXIF only. Display probes original→fullsize→preview.
    // Place enrich runs when the photo is actually shown (see polishImmich).
    function fetchImmichOne() {
        function takeRaw() {
            if (!stream.immichBuf.length || !stream.immichAlbum) return null;
            var seen = knownKeys();
            stream.immichBuf = stream.immichBuf.filter(function (a) { return !seen[a.id]; });
            if (!stream.immichBuf.length) return null;
            // Shuffle On: random unused asset. Off: album page order.
            if (shuffleOn()) {
                var i = Math.floor(Math.random() * stream.immichBuf.length);
                return stream.immichBuf.splice(i, 1)[0];
            }
            return stream.immichBuf.shift();
        }
        function toEntry(a) {
            var album = stream.immichAlbum;
            return Promise.resolve(immichEntry(a, album.origin, album.query, album.name));
        }
        function next() {
            var raw = takeRaw();
            if (raw) return toEntry(raw);
            return fillImmichBuf().then(function () {
                var again = takeRaw();
                if (!again) throw new Error('Immich album exhausted');
                return toEntry(again);
            });
        }
        return next();
    }

    // Enrich place/title when showing; never block plan fill on /assets round-trips.
    function polishImmich(entry) {
        if (!entry || !entry.key || !stream.immichAlbum) return Promise.resolve(entry);
        if ((entry.credit || '').indexOf('Immich') !== 0) return Promise.resolve(entry);
        var album = stream.immichAlbum;
        return fetchImmichAsset(entry.key).then(function (full) {
            if (!full) return entry;
            var merged = mergeImmichAsset({ id: entry.key, exifInfo: {} }, full);
            var better = immichEntry(merged, album.origin, album.query, album.name);
            entry.title = better.title;
            entry.sub = better.sub;
            entry.file = better.file;
            entry.fileFallback = better.fileFallback;
            entry.fileFallbacks = better.fileFallbacks;
            entry.thumb = better.thumb;
            return entry;
        }, function () { return entry; });
    }

    function fetchOne(k) {
        if (k === 'bing') {
            var idx = nextOffset('bing', 50);
            return xhrGet(bingArchiveUrl(idx, 1)).then(function (data) {
                var entry = parseBingImage((data.images || [])[0]);
                if (!entry) throw new Error('empty Bing');
                return entry;
            });
        }
        if (k === 'nasa') {
            var day = nextOffset('nasa', 60);
            return fetchNasaDay(daysAgoKey(day)).then(function (entry) {
                if (!entry) throw new Error('empty NASA');
                return entry;
            });
        }
        if (k === 'wikimedia') {
            var wday = nextOffset('wiki', 60);
            return fetchWikimediaDay(daysAgoKey(wday)).then(function (entry) {
                if (!entry) throw new Error('empty Wikimedia');
                return entry;
            });
        }
        if (k === 'unsplash') {
            var off = nextOffset('unsplash', 40);
            return fetchUnsplashDays([off]).then(function (list) {
                if (!list[0]) throw new Error('empty Unsplash');
                return list[0];
            });
        }
        if (k === 'immich') return fetchImmichOne();
        return Promise.reject(new Error('unknown source'));
    }

    function knownKeys() {
        var seen = {};
        items.forEach(function (w) { seen[w.key] = true; });
        stream.plan.forEach(function (w) { seen[w.key] = true; });
        return seen;
    }

    // One primary source per plan slot. Shuffle picks a random start; failures walk the
    // remaining sources in order (no re-roll), so a fast Wikimedia cannot hog retries.
    function nextSlotStart(keys) {
        if (shuffleOn() && keys.length > 1) {
            return Math.floor(Math.random() * keys.length);
        }
        return stream.sourceIndex++ % keys.length;
    }

    // Short timeout per try; Immich gets longer. Mix walks sources fairly on failure.
    function advanceOne(g) {
        var keys = streamKeys();
        if (!keys.length) return Promise.reject(new Error('no sources'));
        var start = nextSlotStart(keys);
        var tries = 0;
        var maxTries = keys.length === 1 ? 12 : keys.length * 2;

        function attempt() {
            if (g !== generation) return Promise.reject(new Error('stale'));
            if (tries >= maxTries) return Promise.reject(new Error('all sources failed'));
            var k = keys[(start + tries) % keys.length];
            tries++;
            var ms = k === 'immich' ? IMMICH_SOURCE_MS : SOURCE_MS;
            DevLog.log('Live wallpaper: plan ' + k);
            return withTimeout(fetchOne(k), ms).then(function (entry) {
                if (!entry) return attempt();
                var seen = knownKeys();
                if (seen[entry.key] || items.some(function (w) { return w.file === entry.file; }) ||
                    stream.plan.some(function (w) { return w.file === entry.file; })) {
                    return attempt();
                }
                return entry;
            }, function (e) {
                DevLog.log('Live wallpaper: skip ' + k + ': ' + (e && e.message ? e.message : e));
                return attempt();
            });
        }

        return attempt();
    }

    function remember(entry) {
        items = items.filter(function (w) { return w.key !== entry.key; });
        items.push(entry);
        if (items.length > HISTORY_MAX) items = items.slice(items.length - HISTORY_MAX);
        setLiveKey(entry.key);
        if (entry.trackUrl) trackUnsplash([entry]);
        fetchedDay = todayKey();
        lastFailure = 0;
        retryDelay = RETRY_MS;
        lastError = '';
        saveCache(provider());
        DevLog.log('Live wallpaper: showing ' + (entry.credit || entry.title || entry.key));
        notify();
        return entry;
    }

    // Yield so Home/input stay responsive while the upcoming list builds.
    function planPause() {
        var ms = stream.plan.length < 2 ? 0 : 150;
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // Fill upcoming slots in the background; never notify (that re-applied wallpaper each slot).
    function fillPlan(delayMs) {
        if (stream.filling) return stream.filling;
        var g = generation;
        var wait = delayMs > 0 ? delayMs : 0;

        function step() {
            if (g !== generation) return Promise.resolve();
            if (stream.plan.length >= PLAN_SIZE) return Promise.resolve();
            return advanceOne(g).then(function (entry) {
                if (g !== generation || !entry) return;
                stream.plan.push(entry);
                DevLog.log('Live wallpaper: planned ' + stream.plan.length + '/' + PLAN_SIZE +
                    ' (' + (entry.credit || entry.key) + ')');
                return planPause().then(step);
            }, function (e) {
                DevLog.log('Live wallpaper: plan fill stopped: ' + (e && e.message ? e.message : e));
            });
        }

        stream.filling = new Promise(function (resolve) {
            setTimeout(resolve, wait);
        }).then(function () {
            if (g !== generation) return;
            warmImmich();
            return step();
        }).then(function () {
            if (g === generation) stream.filling = null;
        }, function () {
            if (g === generation) stream.filling = null;
        });
        return stream.filling;
    }

    function prefetchNext() {
        fillPlan(0);
    }

    // Paint now with search metadata; polish place/title in the background and notify
    // so the screen saver can refresh the caption without delaying the photo swap.
    function showEntry(entry) {
        remember(entry);
        polishImmich(entry).then(function () { notify(); });
        return Promise.resolve(entry);
    }

    // Next photo from the planned list (or fetch one if the plan is empty).
    function takeNext() {
        var g = generation;
        if (stream.plan.length) {
            var ready = stream.plan.shift();
            fillPlan(0);
            return showEntry(ready);
        }
        return advanceOne(g).then(function (entry) {
            if (g !== generation || !entry) return null;
            fillPlan(0);
            return showEntry(entry);
        }, function (e) {
            if (!items.length) {
                lastFailure = Date.now();
                lastError = providerMeta().label + ' unavailable';
                notify();
            }
            DevLog.log('Live wallpaper: takeNext failed: ' + (e && e.message ? e.message : e));
            fillPlan(0);
            return null;
        });
    }

    // Show one photo as soon as it is ready; top up the plan later so cold start stays snappy.
    function ensureOnDemand(g, beforeKeys) {
        function kickBackground() {
            fetchedDay = todayKey();
            // Let the first wallpaper paint before saturating the network with the plan.
            fillPlan(800);
            return beforeKeys !== keys(items);
        }

        if (items.length) {
            fillPlan(0);
            return Promise.resolve(false);
        }
        if (stream.plan.length) {
            return showEntry(stream.plan.shift()).then(kickBackground);
        }
        return advanceOne(g).then(function (entry) {
            if (g !== generation || !entry) {
                fillPlan(800);
                return false;
            }
            return showEntry(entry).then(kickBackground);
        }, function () {
            fillPlan(800);
            return false;
        });
    }

    function fetchMixPool() {
        return ensureOnDemand(generation, keys(items)).then(function () {
            if (!items.length) throw new Error('empty Mix');
            return items.slice();
        });
    }

    function fetchMixToday() {
        return takeNext();
    }

    function upcoming() {
        return stream.plan.slice();
    }

    function planCount() {
        return stream.plan.length;
    }

    /* ---------- Sources and daily refresh ---------- */

    var SOURCES = {
        bing: { pool: fetchBingPool, today: fetchBingToday },
        nasa: { pool: fetchNasaPool, today: fetchNasaToday },
        wikimedia: { pool: fetchWikimediaPool, today: fetchWikimediaToday },
        unsplash: { pool: fetchUnsplashPool, today: fetchUnsplashToday },
        immich: { pool: fetchImmichPool, today: fetchImmichToday },
        mix: { pool: fetchMixPool, today: fetchMixToday }
    };

    function errorMessage(e, label) {
        if (e && e.status === 401) return label + ' rejected the Access Key';
        if (e && (e.status === 403 || e.status === 429)) return label + ' rate limit reached, retrying later';
        return label + ' unavailable';
    }

    /*
     * Ensures a current photo quickly; the upcoming plan (~15) fills in the background.
     */
    function ensureDaily() {
        if (fetching) return Promise.resolve(false);
        if (Date.now() - lastFailure < retryDelay) return Promise.resolve(false);

        var p = provider();
        var meta = providerMeta();
        if (needsSetup()) return Promise.resolve(false);

        if (items.length && p === 'bing' && cachedMarket !== cfg().market) resetPool();

        var g = generation;
        var before = keys(items);

        if (items.length) {
            if (stream.plan.length < PLAN_SIZE) fillPlan();
            return Promise.resolve(false);
        }

        fetching = true;
        DevLog.log('Live wallpaper: first photo (' + meta.label + ')');
        return ensureOnDemand(g, before).then(function (changed) {
            if (g !== generation) return false;
            fetching = false;
            return changed;
        }, function () {
            if (g !== generation) return false;
            fetching = false;
            return false;
        });
    }

    function list() { return items.slice(); }

    function find(key) {
        return items.find(function (w) { return w.key === key; }) || items[0] || null;
    }

    function status() {
        if (needsSetup()) return provider() === 'immich' ? 'Set an Immich share link' : 'Set an Unsplash Access Key';
        return lastError;
    }

    function clearCache() {
        generation++;
        fetching = false;
        lastFailure = 0;
        retryDelay = RETRY_MS;
        lastError = '';
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        resetPool();
    }

    // Drop upcoming slots only (keep the current photo); used when Shuffle toggles.
    function rebuildPlan() {
        generation++;
        stream.plan = [];
        stream.filling = null;
        // Re-order the Immich page buffer so Shuffle On does not keep album FIFO.
        if (stream.immichBuf && stream.immichBuf.length && shuffleOn()) {
            shuffleInPlace(stream.immichBuf);
        }
        fillPlan();
        notify();
    }

    applyUnsplashStore();
    immichLink = readImmichLink();
    loadCache();
    trim();
    if (items.length) saveCache(cachedProvider);

    window.LiveWallpaper = {
        PROVIDERS: PROVIDERS,
        max: max,
        poolLimit: poolLimit,
        list: list,
        find: find,
        ensureDaily: ensureDaily,
        clearCache: clearCache,
        rebuildPlan: rebuildPlan,
        fetchedDay: function () { return fetchedDay; },
        provider: provider,
        providerLabel: function () { return providerMeta().label; },
        isOnDemand: isOnDemand,
        takeNext: takeNext,
        prefetchNext: prefetchNext,
        upcoming: upcoming,
        planCount: planCount,
        mixSources: mixSourceLabels,
        status: status,
        needsSetup: needsSetup,
        onChange: function (fn) { listeners.push(fn); },
        immichConfigured: immichConfigured,
        setImmichLink: setImmichLink,
        clearImmichLink: clearImmichLink,
        immichSummary: function () {
            return immichConfigured() ? 'Share link set' : 'Set share link';
        },
        unsplashConfigured: unsplashConfigured,
        setUnsplashKey: setUnsplashKey,
        clearUnsplashKey: clearUnsplashKey,
        unsplashCollection: function () { return unsplashCollection; },
        setUnsplashCollection: setUnsplashCollection,
        unsplashKeySummary: function () {
            return unsplashConfigured() ? 'Access Key set' : 'Set Access Key';
        },
        unsplashCollectionSummary: function () {
            var id = unsplashCollection;
            if (!id) return 'Popular photos';
            return id.length > 14 ? id.slice(0, 12) + '…' : id;
        }
    };
})();
