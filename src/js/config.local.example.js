/*
 * Copy this to js/config.local.js and put your own values in it. That file is gitignored, so
 * anything here stays out of the repository while still reaching both `npm run preview` and the
 * packaged .wgt — nothing to strip before a push, nothing to put back before a build.
 *
 * Keys are merged over js/config.js one level deep, so you can set weather.latitude without
 * restating the rest of the block. Arrays (apps, inputs) replace the default wholesale.
 */
window.LAUNCHER_LOCAL = {
    // Weather: prefer Settings → Weather on the TV. Optional seed before first prefs save:
    // weather: { latitude: 48.86, longitude: 2.35, unit: 'celsius' },

    // Optional first-run seed for Music. Prefer Settings → Music on the TV afterwards.
    // subsonic: {
    //     baseUrl: 'http://192.168.1.10:4533',
    //     user: 'me',
    //     password: 'secret',
    //     maxBitRate: 320
    // },

    // Live wallpapers (metadata cache only; max = rolling daily pool size, default 50).
    // Provider in Settings → Background (bing | nasa | wikimedia | unsplash | immich | mix).
    // liveWallpaper: { market: 'en-GB', max: 50, unsplashAccessKey: 'YOUR_ACCESS_KEY' },
    // Immich album (share link from Immich → Sharing → Shared links):
    // liveWallpaper: { market: 'en-GB', max: 50, immichLink: 'https://host/share/KEY' },
    // Unsplash collection (optional; empty = popular photos):
    // liveWallpaper: { market: 'en-GB', max: 50, unsplashCollection: 'COLLECTION_ID' },

    // Receives Lab logs; see scripts/devlog-server.mjs.
    // devLogUrl: null,

    // locale: 'fr-FR',
};
