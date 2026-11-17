/*
 * Live wallpapers: Bing (no key), NASA APOD (apod.nasa.gov pages, no key), Wikimedia Picture of
 * the Day (no key), Unsplash (Access Key).
 *
 * Metadata only in localStorage (url, title, credit, date key) — never image bytes.
 * Pool length is capped at liveWallpaper.max. Once a day a new image is prepended
 * and the oldest dropped so the count stays consistent.
 *
 * NASA uses APOD HTML (og:image), not api.nasa.gov — that API's DEMO_KEY is shared /
 * rate-limited and often returns logo placeholders.
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

    var CACHE_KEY = 'arn0.liveWallpaper.v3';
    var IMMICH_STORE = 'arn0.immich.v1';
    var UNSPLASH_KEY_STORE = 'arn0.unsplash.v1';
    var TIMEOUT_MS = 15000;
    var BING = 'https://www.bing.com';
    var APOD = 'https://apod.nasa.gov/apod/';
    var UNSPLASH = 'https://api.unsplash.com';
    var NASA_CHUNK = 5;
    var NASA_EXTRA_DAYS = 180;
    var WIKIMEDIA_EXTRA_DAYS = 10;
    var UNSPLASH_PER_PAGE = 30;
    var UNSPLASH_PAGES = 50;
    var RETRY_MS = 5 * 60 * 1000;
    var RATE_LIMIT_MS = 60 * 60 * 1000;
    var FETCH_LIMIT_MS = 90 * 1000;

    var PROVIDERS = [
        { key: 'bing', label: 'Bing', needsKey: false },
        { key: 'nasa', label: 'NASA APOD', needsKey: false },
        { key: 'wikimedia', label: 'Wikimedia POTD', needsKey: false },
        { key: 'unsplash', label: 'Unsplash', needsKey: true },
        { key: 'immich', label: 'Immich album', needsKey: true }
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
            max: Math.max(1, Math.min(15, c.max || 15)),
            unsplashAccessKey: c.unsplashAccessKey || '',
            immichLink: c.immichLink || '',
            unsplashCollection: c.unsplashCollection || ''
        };
    }

    function max() { return cfg().max; }

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

    function resetPool() {
        items = [];
        fetchedDay = '';
        cachedProvider = '';
        cachedMarket = '';
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
            items = raw.items.slice(0, max()).map(normalize);
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
        if (items.length > max()) items = items.slice(0, max());
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

    function xhrGet(url, headers, asText) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = TIMEOUT_MS;
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

    // Bing accepts n ≤ 8 per call; page with idx to fill up to max (15).
    function fetchBingPool() {
        var need = max();
        var collected = [];
        var seen = {};

        function page(idx) {
            var n = Math.min(8, need - collected.length);
            if (n <= 0 || idx > 14) {
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

    function metaContent(html, prop) {
        var re1 = new RegExp('property="' + prop + '"\\s+content="([^"]+)"', 'i');
        var re2 = new RegExp('content="([^"]+)"\\s+property="' + prop + '"', 'i');
        var m = html.match(re1) || html.match(re2);
        return m ? decodeEntities(m[1]) : '';
    }

    function nasaFileOk(file) {
        if (!file || file.length < 12) return false;
        return !/nasa-logo|favicon|themes\/nasa-child|editor-page-nasa-logo/i.test(file);
    }

    // Both preview and TV parse the same APOD page HTML, so there is one parser.
    function parseApodHtml(html, ymd) {
        // Placeholder days carry a generic "APOD - NASA Science" title and a stock picture.
        if (!/^APOD: \d{4} /.test(metaContent(html, 'og:title'))) return null;
        var file = metaContent(html, 'og:image:secure_url') || metaContent(html, 'og:image');
        if (!nasaFileOk(file)) return null;
        var title = metaContent(html, 'og:image:alt') || metaContent(html, 'og:title') || '';
        title = title.replace(/^APOD:\s*/i, '')
            .replace(/^\d{4} [A-Za-z]+ \d{1,2}\s*[–-]\s*/, '')
            .replace(/\s*-\s*NASA Science\s*$/i, '')
            .trim();
        if (!title || /^APOD$/i.test(title)) title = 'NASA APOD';
        return normalize({
            key: ymd,
            title: title,
            file: file,
            thumb: file,
            credit: 'NASA APOD'
        });
    }

    function apodPageUrl(ymd) {
        var p = ymd.split('-');
        return APOD + 'ap' + p[0].slice(2) + p[1] + p[2] + '.html';
    }

    function fetchNasaDay(ymd) {
        var url = preview() ? '/api/live/apod?date=' + encodeURIComponent(ymd) : apodPageUrl(ymd);
        return xhrGet(url, null, true).then(function (html) {
            return parseApodHtml(html, ymd);
        });
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

    function fetchNasaPool() {
        return collectDays(fetchNasaDay, max(), NASA_EXTRA_DAYS);
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
            key: ymd,
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

    function fetchWikimediaPool() {
        return collectDays(fetchWikimediaDay, max(), WIKIMEDIA_EXTRA_DAYS);
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
            'w=1920&h=1080&fit=crop&q=85&auto=format';
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

    function fetchUnsplashPool() {
        return fetchUnsplashDays(range(max())).then(function (list) {
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

    function xhrPostJson(url, body) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.timeout = TIMEOUT_MS;
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
        return xhrGet(immichApi('/shared-links/me?' + s.query));
    }

    // Same day mapping as Unsplash: each day is a fixed asset in the album order.
    // The shared link does not list album contents, so the album's assets come from search.
    function immichTitle(a) {
        var x = a.exifInfo || {};
        var place = [x.city, x.state, x.country].filter(Boolean).join(', ');
        return place || '';
    }

    function immichDate(a) {
        // localDateTime is the wall-clock time where the photo was taken; reading its date part
        // avoids shifting the day through the TV's own timezone.
        var x = a.exifInfo || {};
        var m = String(a.localDateTime || x.dateTimeOriginal || a.fileCreatedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        var when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // Same day mapping as Unsplash: each day is a fixed asset in the album order.
    // The shared link does not list album contents, so the album's assets come from search.
    function fetchImmichDays(offsets) {
        return fetchImmichLinkData().then(function (link) {
            var s = parseImmichLink(immichLink);
            var album = (link.album && link.album.albumName) || '';
            if (!link.album || !link.album.id) throw new Error('Immich link is not an album');
            return xhrPostJson(immichApi('/search/metadata?' + s.query), {
                albumIds: [link.album.id],
                type: 'IMAGE',
                size: 200,
                withExif: true
            }).then(function (res) {
                var assets = ((res.assets && res.assets.items) || []).filter(function (a) {
                    return a.type === 'IMAGE';
                });
                if (!assets.length) throw new Error('empty Immich album');
                var today = dayNumber(new Date());
                return offsets.map(function (o) {
                    var g = today - o;
                    var a = assets[((g % assets.length) + assets.length) % assets.length];
                    var base = s.origin + '/api/assets/' + encodeURIComponent(a.id);
                    var q = '&' + s.query;
                    return normalize({
                        key: a.id,
                        title: immichTitle(a),
                        sub: immichDate(a),
                        file: base + '/thumbnail?size=preview' + q,
                        thumb: base + '/thumbnail?size=thumbnail' + q,
                        credit: album ? 'Immich · ' + album : 'Immich'
                    });
                });
            });
        });
    }

    function fetchImmichPool() {
        return fetchImmichDays(range(max())).then(function (list) {
            var seen = {};
            return list.filter(function (e) {
                if (seen[e.key]) return false;
                seen[e.key] = true;
                return true;
            });
        });
    }

    function fetchImmichToday() {
        return fetchImmichDays([0]).then(function (list) { return list[0]; });
    }

    /* ---------- Sources and daily refresh ---------- */

    var SOURCES = {
        bing: { pool: fetchBingPool, today: fetchBingToday },
        nasa: { pool: fetchNasaPool, today: fetchNasaToday },
        wikimedia: { pool: fetchWikimediaPool, today: fetchWikimediaToday },
        unsplash: { pool: fetchUnsplashPool, today: fetchUnsplashToday },
        immich: { pool: fetchImmichPool, today: fetchImmichToday }
    };

    function errorMessage(e, label) {
        if (e && e.status === 401) return label + ' rejected the Access Key';
        if (e && (e.status === 403 || e.status === 429)) return label + ' rate limit reached, retrying later';
        return label + ' unavailable';
    }

    /*
     * Ensures the pool is ready and today's image is included when the calendar day changed.
     * Resolves to true if the list changed.
     */
    function ensureDaily() {
        if (fetching) return Promise.resolve(false);
        if (Date.now() - lastFailure < retryDelay) return Promise.resolve(false);

        var p = provider();
        var meta = providerMeta();
        if (needsSetup()) return Promise.resolve(false);

        if (items.length && p === 'bing' && cachedMarket !== cfg().market) resetPool();

        var full = !items.length;
        if (!full && fetchedDay === todayKey()) return Promise.resolve(false);

        var g = generation;
        var before = keys(items);
        fetching = true;
        DevLog.log('Live wallpaper: fetching ' + meta.label + (full ? ' pool' : ' today'));
        var work = full ? SOURCES[p].pool() : SOURCES[p].today();
        // A request that never settles would otherwise leave the fill "in progress" for good.
        var watchdog = setTimeout(function () {
            if (g !== generation || !fetching) return;
            fetching = false;
            lastFailure = Date.now();
            lastError = meta.label + ' did not respond';
            DevLog.log('Live wallpaper: ' + meta.label + ' timed out');
            notify();
        }, FETCH_LIMIT_MS);

        return work.then(function (result) {
            clearTimeout(watchdog);
            if (g !== generation) return false;
            fetching = false;
            lastFailure = 0;
            retryDelay = RETRY_MS;
            lastError = '';

            var added = full ? result : (result ? [result] : []);
            if (full) items = result.slice(0, max());
            else if (result) mergeToday(result);
            fetchedDay = todayKey();
            saveCache(p);
            if (p === 'unsplash') trackUnsplash(added);
            DevLog.log('Live wallpaper: ' + meta.label + (full ? ' filled ' : ' top-up ') +
                items.length + ' / max ' + max());
            notify();
            return before !== keys(items);
        }, function (e) {
            clearTimeout(watchdog);
            if (g !== generation) return false;
            fetching = false;
            lastFailure = Date.now();
            var limited = e && (e.status === 403 || e.status === 429);
            retryDelay = limited ? RATE_LIMIT_MS : RETRY_MS;
            lastError = errorMessage(e, meta.label);
            DevLog.log('Live wallpaper: ' + (e && e.message ? e.message : e));
            notify();
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

    applyUnsplashStore();
    immichLink = readImmichLink();
    loadCache();
    trim();
    if (items.length) saveCache(cachedProvider);

    window.LiveWallpaper = {
        PROVIDERS: PROVIDERS,
        max: max,
        list: list,
        find: find,
        ensureDaily: ensureDaily,
        clearCache: clearCache,
        fetchedDay: function () { return fetchedDay; },
        provider: provider,
        providerLabel: function () { return providerMeta().label; },
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
