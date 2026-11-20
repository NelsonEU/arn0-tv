/*
 * Home screen content.
 *
 * apps: each entry picks the first installed app matching it:
 *   { id: 'org.tizen.netflix-app' }   exact app id (most reliable; see "All apps", the id of
 *                                     the focused app is shown at the bottom)
 *   { match: 'netflix' }              case-insensitive regex on id or name
 *   label                             optional display name
 *   brand                             optional key from js/brands.js (otherwise guessed from the name)
 *   iconPad                           optional [vertical, horizontal] % inset override
 *                                     (native icons are auto-cropped; rarely needed)
 * Entries that match nothing are skipped.
 *
 * inputs: HDMI ports shown in the second row. Set `hdmi` to the port each device is plugged into.
 */
window.LAUNCHER_CONFIG = {
    apps: [
        // Live TV / antenna-cable channels. Pin by id so the consumer filter cannot hide it.
        // On your TV, confirm the id in All apps (Yellow) if the tile is missing.
        { id: 'com.samsung.tv.coba.livetv', label: 'TV', brand: 'livetv' },
        { id: 'org.tizen.browser', label: 'Internet', brand: 'internet' },
        { id: 'xvvl3S1TT1.TizenTubeStandalone', label: 'YouTube', brand: 'youtube' },
        { id: 'rJeHak5zRg.Spotify', label: 'Spotify' },
        { id: 'Jz7aUrV2Q4.Twitch', label: 'Twitch' },
        { id: 'E0P3lRI4H7.MYTF1', label: 'TF1+' },
        { id: 'org.tizen.netflix-app', label: 'Netflix' },
        { id: 'org.tizen.primevideo', label: 'Prime Video' },
        { id: 'MCmYXNxgcu.DisneyPlus', label: 'Disney+' },
        { id: 'com.samsung.tv.aria-video', label: 'Apple TV' },
        { match: 'moonlight', label: 'Moonlight' }
    ],

    inputs: [
        { hdmi: 1, label: 'Nintendo Switch 2', brand: 'switch' },
        { hdmi: 2, label: 'PlayStation 5', brand: 'playstation' },
        { hdmi: 4, label: 'Xbox Series X', brand: 'xbox' }
    ],

    // How an input tile switches the TV. See README "HDMI inputs".
    //   'switch+viewer'  set the TV source, then open Samsung's TV viewer (default)
    //   'switch'         only set the TV source
    //   'inapp'          show the input full screen inside the launcher (Back returns)
    inputMethod: 'switch+viewer',

    locale: 'en-GB',

    theme: {
        // Starting wallpaper (key from js/wallpapers.js), or null for none (plain gradient).
        // Changed from Settings → Background; the TV remembers the choice.
        wallpaper: null
    },

    /*
     * Live backgrounds (Settings → Background → Live). Providers: Bing, NASA APOD,
     * Wikimedia, Unsplash, Immich, or Mix. Only URLs/titles are cached locally — never
     * image files. Photos are fetched on demand (one at a time) with a small recent history.
     */
    liveWallpaper: {
        market: 'en-GB',        // Bing regional edition (en-GB, de-DE, fr-FR, it-IT, …)
        max: 50,
        unsplashAccessKey: null, // optional seed; prefer Settings → Background on the TV
        immichLink: null,        // optional Immich shared album link; prefer Settings → Background
        unsplashCollection: null // optional Unsplash collection id; null = popular photos, one per day
    },

    /*
     * Weather defaults for the screen saver corner (Open-Meteo). Settings → Weather is the
     * usual way to set place (detect / search) and unit on the TV; values here only seed prefs on first run
     * (or when you set coordinates in config.local.js before the first save).
     */
    weather: {
        latitude: null,
        longitude: null,
        unit: 'celsius'         // 'celsius' | 'fahrenheit'
    },

    /*
     * OpenSubsonic / Subsonic defaults. Usual path: Settings → Music on the TV (saved there,
     * no rebuild). Values here / in config.local.js only seed the TV the first time.
     */
    subsonic: {
        baseUrl: null,          // e.g. 'http://192.168.1.10:4533'
        user: null,
        password: null,
        maxBitRate: 320
    },

    /*
     * EXPERIMENTAL navigation sound. Synthesised, so there is no audio file. `move` plays when
     * focus changes, `edge` when it cannot (the end of a row). Tune by ear in the browser
     * preview; `volume` is 0–1 and sits on top of the TV's own volume.
     *
     * Whether this is worth keeping depends on the TV's audio latency: run
     * "Sound: report audio latency" in the Lab screen. Set enabled to false to silence it.
     */
    sound: {
        enabled: true,
        preset: 'soft',
        volume: 0.08,
        minGapMs: 45,
        presets: {
            soft: { label: 'Soft', freq: 620, ms: 30, type: 'sine' },
            warm: { label: 'Warm', freq: 520, ms: 44, type: 'triangle' },
            bright: { label: 'Bright', freq: 1040, ms: 30, type: 'triangle' }
        },
        move: { freq: 880, ms: 38, type: 'triangle' },
        edge: { freq: 200, ms: 70, type: 'sine' },
        select: { freq: 1320, ms: 55, type: 'triangle' }
    },

    // Development only: where the Lab screen sends its logs (npm run devlog on your computer).
    // null disables it; set it to http://<your-computer-ip>:8099/log while debugging.
    devLogUrl: null
};

/*
 * Local overrides from js/config.local.js, which is gitignored and loaded just before this file.
 * That is where values specific to one TV belong — coordinates, a devlog address — so this file
 * can stay in the repository with nulls in it. Nothing to strip before a push, nothing to put
 * back before a build, and the overlay reaches the browser preview and the .wgt alike.
 *
 * Merged one level deep, so a local file can set weather.latitude without restating the rest of
 * the block. Arrays (apps, inputs) and plain values replace the default outright.
 */
(function () {
    'use strict';

    var local = window.LAUNCHER_LOCAL;
    if (!local) return;

    function plainObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v);
    }

    Object.keys(local).forEach(function (key) {
        if (plainObject(local[key]) && plainObject(window.LAUNCHER_CONFIG[key])) {
            Object.keys(local[key]).forEach(function (inner) {
                window.LAUNCHER_CONFIG[key][inner] = local[key][inner];
            });
        } else {
            window.LAUNCHER_CONFIG[key] = local[key];
        }
    });
})();
