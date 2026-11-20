/*
 * OpenSubsonic / Subsonic REST client for ambient random playback.
 *
 * Credentials: Settings → Music (saved on the TV), seeded once from config.local.js if empty.
 * Stored in a separate localStorage key so Advanced → Export does not dump the password.
 * Auth uses hex-encoded password (p=enc:...).
 */
(function () {
    'use strict';

    var CLIENT = 'arn0';
    var API_VER = '1.16.1';
    var TIMEOUT_MS = 12000;
    var CREDS_KEY = 'arn0.subsonic.creds.v1';

    var creds = { baseUrl: '', user: '', password: '' };

    function configDefaults() {
        var c = (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.subsonic) || {};
        return {
            baseUrl: (c.baseUrl || '').replace(/\/+$/, ''),
            user: c.user || '',
            password: c.password || '',
            maxBitRate: c.maxBitRate || 320
        };
    }

    function loadCreds() {
        var defaults = configDefaults();
        try {
            var saved = JSON.parse(localStorage.getItem(CREDS_KEY));
            if (saved && typeof saved === 'object') {
                creds.baseUrl = (saved.baseUrl || '').replace(/\/+$/, '');
                creds.user = saved.user || '';
                creds.password = saved.password || '';
                return;
            }
        } catch (e) {
            // Fall through to seed.
        }
        // First run: seed from config.local.js if present.
        creds = {
            baseUrl: defaults.baseUrl,
            user: defaults.user,
            password: defaults.password
        };
        if (creds.baseUrl || creds.user || creds.password) saveCreds();
    }

    function saveCreds() {
        try {
            localStorage.setItem(CREDS_KEY, JSON.stringify({
                baseUrl: creds.baseUrl,
                user: creds.user,
                password: creds.password
            }));
            return true;
        } catch (e) {
            DevLog.log('Subsonic: could not save credentials');
            return false;
        }
    }

    function cfg() {
        var defaults = configDefaults();
        return {
            baseUrl: (creds.baseUrl || '').replace(/\/+$/, ''),
            user: creds.user || '',
            password: creds.password || '',
            maxBitRate: defaults.maxBitRate
        };
    }

    function setCreds(patch) {
        if (patch.baseUrl !== undefined) creds.baseUrl = String(patch.baseUrl || '').replace(/\/+$/, '');
        if (patch.user !== undefined) creds.user = String(patch.user || '');
        if (patch.password !== undefined) creds.password = String(patch.password || '');
        saveCreds();
    }

    function clearCreds() {
        try { localStorage.removeItem(CREDS_KEY); } catch (e) { /* ignore */ }
        creds = { baseUrl: '', user: '', password: '' };
        var defaults = configDefaults();
        if (defaults.baseUrl || defaults.user || defaults.password) {
            creds = {
                baseUrl: defaults.baseUrl,
                user: defaults.user,
                password: defaults.password
            };
        }
    }

    function configured() {
        var c = cfg();
        return !!(c.baseUrl && c.user && c.password);
    }

    function encPassword(pw) {
        var bytes = unescape(encodeURIComponent(pw));
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
            hex += ('0' + bytes.charCodeAt(i).toString(16)).slice(-2);
        }
        return 'enc:' + hex;
    }

    function authQuery(plain) {
        var c = cfg();
        return 'u=' + encodeURIComponent(c.user) +
            '&p=' + encodeURIComponent(plain ? c.password : encPassword(c.password)) +
            '&v=' + encodeURIComponent(API_VER) +
            '&c=' + encodeURIComponent(CLIENT) +
            '&f=json';
    }

    function xhrGet(url) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = TIMEOUT_MS;
            xhr.onload = function () {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error('HTTP ' + xhr.status));
                    return;
                }
                try {
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

    function unwrap(data) {
        var r = data && data['subsonic-response'];
        if (!r) throw new Error('bad response');
        if (r.status === 'failed') {
            var err = (r.error && r.error.message) || 'Subsonic error';
            var e = new Error(err);
            e.code = r.error && r.error.code;
            throw e;
        }
        return r;
    }

    function api(path, params, plain) {
        var c = cfg();
        if (!configured()) return Promise.reject(new Error('not configured'));
        var q = authQuery(!!plain);
        if (params) {
            Object.keys(params).forEach(function (k) {
                if (params[k] === undefined || params[k] === null) return;
                q += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
            });
        }
        var url = c.baseUrl + '/rest/' + path + '.view?' + q;
        return xhrGet(url).then(unwrap).catch(function (err) {
            if (!plain && (err.code === 40 || err.code === 41 || /password|auth/i.test(err.message || ''))) {
                return api(path, params, true);
            }
            throw err;
        });
    }

    function ping() {
        return api('ping').then(function () { return true; });
    }

    function mapSong(s) {
        return {
            id: String(s.id),
            title: s.title || 'Unknown',
            artist: s.artist || s.albumArtist || '',
            album: s.album || ''
        };
    }

    function asList(value) {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    }

    function getRandomSongs(size) {
        return api('getRandomSongs', { size: size || 20 }).then(function (r) {
            return asList(r.randomSongs && r.randomSongs.song).map(mapSong);
        });
    }

    function getPlaylists() {
        return api('getPlaylists').then(function (r) {
            return asList(r.playlists && r.playlists.playlist).map(function (p) {
                return {
                    id: String(p.id),
                    name: p.name || 'Playlist',
                    songCount: typeof p.songCount === 'number' ? p.songCount : null
                };
            });
        });
    }

    function getPlaylist(id) {
        return api('getPlaylist', { id: id }).then(function (r) {
            var pl = r.playlist || {};
            return {
                id: String(pl.id != null ? pl.id : id),
                name: pl.name || 'Playlist',
                songs: asList(pl.entry).map(mapSong)
            };
        });
    }

    function streamUrl(songId) {
        var c = cfg();
        return c.baseUrl + '/rest/stream.view?' + authQuery(false) +
            '&id=' + encodeURIComponent(songId) +
            '&maxBitRate=' + encodeURIComponent(c.maxBitRate) +
            '&format=mp3';
    }

    function summary() {
        var c = cfg();
        if (!c.baseUrl) return 'No server';
        return c.baseUrl.replace(/^https?:\/\//, '') + (c.user ? ' · ' + c.user : '');
    }

    loadCreds();

    window.Subsonic = {
        configured: configured,
        ping: ping,
        getRandomSongs: getRandomSongs,
        getPlaylists: getPlaylists,
        getPlaylist: getPlaylist,
        streamUrl: streamUrl,
        cfg: cfg,
        setCreds: setCreds,
        clearCreds: clearCreds,
        summary: summary
    };
})();
