/* App listing, filtering and launching on top of tizen.application. */
(function () {
    'use strict';

    var t = function () { return I18n.t.apply(null, arguments); };

    // Samsung's `show` flag still lets many services through (e.g. ep-dataservice-app).
    // Store apps have ids like "AbCdEfGhIj.Name"; a few consumer apps ship preinstalled with system ids.
    var STORE_ID = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/;
    var NUMERIC_ID = /^\d{9,13}$/;
    var PRELOADED = [
        'org.tizen.netflix-app', 'org.tizen.primevideo', 'org.tizen.apple.apple-music',
        'org.tizen.browser', 'com.samsung.tv.aria-video', 'org.tizen.tv-viewer'
    ];
    // Preinstalled apps whose own name is an internal one. English keys, translated by t().
    var NAMES = {
        'org.tizen.tv-viewer': 'Live TV'       // Samsung's viewer: antenna, cable or satellite channels
    };
    var INTERNAL = [
        'adplatform.ADPlayer', 'WykOS4t4F0.cmsWebApp', '25emanual3.emanual',
        'ZODRT12q2l.WebAccountExtension', 'ByJlgt0XeD.CastSettingsApp', 'tv6pbVMQFF.PrivacyChoices',
        '2022ePop01.SmartTV', 'w2VwCK465D.OTApp', 'J9fZJDMi1v.SecurityCenter'
    ];
    // Not 'launcher': CANAL+ and Prime Video ship as QmpwflxWdt.CanalPlusLauncher and
    // evKhCgZelL.AmazonIgnitionLauncher2; this launcher is already left out by its own id.
    // 'test' only after a separator or as 'testsuite' (org.tizen.sound-test, YouTubeTestSuite):
    // Czech Television's iVysílání ships as j7L028mExx.ivysilaniTest and is a real app.
    var NOISE = /service|worker|preview|promotion|plugin|[\s.-]test|testsuite|sdk|^ep[ -]|factory|daemon|dummy|agent|e-?manual|account|adplayer|privacy|security/i;

    function withTimeout(promise, ms, what) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () { reject(new Error(what + ': the TV did not respond')); }, ms);
            promise.then(function (v) { clearTimeout(timer); resolve(v); },
                function (e) { clearTimeout(timer); reject(e); });
        });
    }

    function selfAppId() {
        try {
            return tizen.application.getCurrentApplication().appInfo.id;
        } catch (e) {
            return null;
        }
    }

    function getInstalledApps() {
        return withTimeout(new Promise(function (resolve, reject) {
            tizen.application.getAppsInfo(resolve, reject);
        }), 8000, 'App list');
    }

    function launch(appId) {
        return withTimeout(new Promise(function (resolve, reject) {
            tizen.application.launch(appId, resolve, reject);
        }), 8000, 'Launch');
    }

    /*
     * EXPERIMENTAL (Settings → Avancé). Launches through an app control with a reply listener:
     * Tizen answers the caller when the launched app ends, and the launcher relaunches itself
     * to come back to the front. Nothing runs meanwhile (the launcher's JavaScript is paused in
     * the background), so the app gets the same CPU and memory as a plain launch. Whether the
     * answer arrives depends on how each app exits; if it never does, this behaves like launch().
     */
    var MIN_SESSION_MS = 4000; // an answer sooner than this is the app acknowledging, not closing

    function launchReturning(appId) {
        var started = Date.now();
        var back = function () {
            var self = selfAppId();
            if (!self || Date.now() - started < MIN_SESSION_MS) return;
            try { tizen.application.launch(self); } catch (e) { /* stay where we are */ }
        };
        return withTimeout(new Promise(function (resolve, reject) {
            var control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default');
            tizen.application.launchAppControl(control, appId, resolve, reject,
                { onsuccess: back, onfailure: back });
        }), 8000, 'Launch');
    }

    function isConsumer(app) {
        if (PRELOADED.indexOf(app.id) >= 0) return true;
        if (!app.show || INTERNAL.indexOf(app.id) >= 0) return false;
        if (!STORE_ID.test(app.id) && !NUMERIC_ID.test(app.id)) return false;
        return !NOISE.test(app.name + ' ' + app.id);
    }

    // Everything launchable with a name, minus ourselves. Curated entries match against this,
    // so any app can still be pinned by id even if the consumer filter hides it.
    function launchable(apps) {
        var self = selfAppId();
        var seen = {};
        return apps.filter(function (a) {
            if (!a.name || a.id === self || seen[a.id]) return false;
            seen[a.id] = true;
            return true;
        });
    }

    function curated(apps, cfg) {
        var used = {};
        var out = [];
        (cfg.apps || []).forEach(function (entry) {
            var re = entry.match ? new RegExp(entry.match, 'i') : null;
            var candidates = apps.filter(function (a) {
                if (used[a.id]) return false;
                if (entry.id) return a.id === entry.id;
                return re && (re.test(a.id) || re.test(a.name));
            });
            // Prefer a visible consumer app when several match (e.g. Netflix and a Netflix service).
            var app = candidates.find(isConsumer) || candidates[0];
            if (app) {
                used[app.id] = true;
                out.push(toItem(app, entry));
            }
        });
        return out;
    }

    /*
     * pinned: the Home items. Their label and brand carry over, so an app reads the same in both
     * places ("Moonlight", not the store's "MoonlightNaCl"). Some TVs also hold two copies of one
     * app (a preloaded org.tizen.netflix-app and the store's Netflix): outside "show everything",
     * one entry per name is kept, the one pinned on Home if either is.
     *
     * hidden: ids the viewer chose to hide. Left out, except under "show everything", where they
     * come back marked so they can be shown again.
     */
    function allSorted(apps, showEverything, pinned, hidden) {
        hidden = hidden || [];
        var onHome = {};
        (pinned || []).forEach(function (p) { onHome[p.id] = { label: p.label, brand: p.brand && p.brand.key }; });
        var seen = {};
        return apps
            .filter(function (a) { return showEverything ? a.show : isConsumer(a) && hidden.indexOf(a.id) < 0; })
            .map(function (a) {
                var item = toItem(a, onHome[a.id] || {});
                item.hidden = hidden.indexOf(a.id) >= 0;
                return item;
            })
            .sort(function (x, y) { return (onHome[y.id] ? 1 : 0) - (onHome[x.id] ? 1 : 0); })
            .filter(function (item) {
                var key = item.label.toLowerCase();
                if (!showEverything && seen[key]) return false;
                seen[key] = true;
                return true;
            })
            .sort(function (x, y) { return x.label.localeCompare(y.label); });
    }

    // Store names often carry a tagline: "Spotify - Music and Podcasts", "TF1+ : Streaming, …"
    function shortName(name) {
        return name.split(/\s+[-:|–]\s+/)[0].trim() || name;
    }

    function toItem(app, entry) {
        return {
            kind: 'app',
            id: app.id,
            label: entry.label || (NAMES[app.id] ? t(NAMES[app.id]) : shortName(app.name)),
            brand: entry.brand ? findBrand(entry.brand) : findBrand(app),
            iconPath: app.iconPath || ''
        };
    }

    function describe(app) {
        return {
            id: app.id, name: app.name, show: app.show, packageId: app.packageId,
            categories: app.categories ? Array.prototype.slice.call(app.categories) : [],
            iconPath: app.iconPath, version: app.version, consumer: isConsumer(app)
        };
    }

    window.Apps = {
        getInstalledApps: getInstalledApps,
        launchable: launchable,
        curated: curated,
        allSorted: allSorted,
        describe: describe,
        launch: launch,
        launchReturning: launchReturning,
        withTimeout: withTimeout
    };
})();
