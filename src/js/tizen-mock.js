/*
 * Minimal fake of the Tizen APIs the launcher uses, for desktop-browser preview.
 * Does nothing when running on the TV.
 * The app ids below are illustrative; use "All apps" on the TV for real ones.
 */
(function () {
    'use strict';
    if (window.tizen) return;
    window.__TIZEN_MOCK__ = true;

    function app(id, name, show) {
        return { id: id, name: name, show: show !== false, iconPath: '', categories: [], packageId: id.split('.')[0] };
    }

    var apps = [
        app('Arn0Lnchr0.Launcher', 'Arn0 Launcher'),
        app('xvvl3S1TT1.TizenTubeStandalone', 'TizenTube'),
        app('com.samsung.tv.cobalt-yt', 'YouTube'),
        app('org.tizen.netflix-app', 'Netflix'),
        app('org.tizen.primevideo', 'Prime Video'),
        app('MCmYXNxgcu.DisneyPlus', 'Disney+'),
        app('com.samsung.tv.aria-video', 'Apple TV'),
        app('rJeHak5zRg.Spotify', 'Spotify'),
        app('Jz7aUrV2Q4.Twitch', 'Twitch'),
        app('E0P3lRI4H7.MYTF1', 'TF1+ : Streaming, TV en Direct'),
        app('MovistarPl.MovistarPlus', 'Movistar Plus+'),
        app('PlexMedia0.Plex', 'Plex'),
        app('DaznApp000.DAZN', 'DAZN'),
        app('RtveTvApp0.RTVEPlay', 'RTVE Play'),
        app('Atresplay0.atresplayer', 'atresplayer'),
        app('JIFtSZfRwy.voyoTizenCZ', 'Oneplay'),
        app('MoonfinApp.moonfin', 'Moonfin'),
        app('sLZ6zpyDlX.iPrimaTizen', 'Prima+'),
        app('j7L028mExx.ivysilaniTest', 'iVysílání ČT'),
        app('org.tizen.tv-viewer', 'tv-viewer', false),
        app('org.tizen.browser', 'Internet'),
        // Noise that the consumer filter should hide
        app('com.samsung.tv.ep-dataservice-app', 'ep-dataservice-app'),
        app('adplatform.ADPlayer', 'ADPlayer'),
        app('com.samsung.tv.store', 'Apps'),
        app('25emanual3.emanual', 'e-Manual'),
        app('org.tizen.volume-setting', 'Volume', false)
    ];

    var sources = {
        connected: [{ type: 'TV', number: 1 }, { type: 'HDMI', number: 2 }, { type: 'HDMI', number: 4 }],
        disconnected: [{ type: 'HDMI', number: 1 }, { type: 'HDMI', number: 3 }]
    };
    var currentSource = sources.connected[0];

    function later(fn) { setTimeout(fn, 60); }

    window.tizen = {
        application: {
            getAppsInfo: function (ok) { later(function () { ok(apps.slice()); }); },
            launch: function (id, ok, err) {
                console.log('[mock] launch', id);
                if (id === 'rJeHak5zRg.Spotify') {
                    later(function () { err({ name: 'NotFoundError', message: 'Mock launch failure' }); });
                    return;
                }
                later(ok);
            },
            getCurrentApplication: function () {
                return { appInfo: { id: 'Arn0Lnchr0.Launcher' }, exit: function () {}, hide: function () {} };
            }
        },
        systeminfo: {
            getPropertyValue: function (prop, ok, err) {
                if (prop !== 'VIDEOSOURCE') { later(function () { err({ name: 'NotSupportedError', message: prop }); }); return; }
                later(function () { ok(sources); });
            }
        },
        tvwindow: {
            setSource: function (src, ok) { console.log('[mock] setSource', src); currentSource = src; later(function () { ok(src); }); },
            getSource: function () { return currentSource; },
            show: function (ok) { console.log('[mock] tvwindow.show'); later(ok); },
            hide: function (ok) { console.log('[mock] tvwindow.hide'); later(ok); }
        },
        tvinputdevice: {
            registerKey: function () {},
            registerKeyBatch: function () {},
            unregisterKey: function () {},
            getSupportedKeys: function () { return []; }
        }
    };
})();
