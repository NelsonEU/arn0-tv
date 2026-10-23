/* Home, All apps and Lab screens; app list loading, launching and HDMI inputs. */
(function () {
    'use strict';

    var CACHE_KEY = 'arn0.apps.v1';
    var REFRESH_AFTER_MS = 5 * 60 * 1000;
    var GRID_COLS = 5;

    var cfg = window.LAUNCHER_CONFIG;
    var log = DevLog.log;
    var $ = UI.$;
    var el = UI.el;
    var KEY = UI.KEY;
    var t = I18n.t;

    var state = {
        apps: [],              // launchable apps from the TV (or the cache)
        appsSig: null,
        lastFetch: 0,
        showEverything: false, // All apps: bypass the consumer filter
        tvMode: false,         // HDMI shown inside the launcher
        hdmi: {}               // last known { port: connected }
    };

    // ---------- Tiles

    // Pre-coloured by scripts/build-marks.mjs
    function markEl(brand) {
        var m = new Image();
        m.className = 'mark';
        m.src = 'img/tiles/' + brand.key + '.svg';
        if (brand.pad) {
            m.style.top = brand.pad[0] + '%';
            m.style.height = (100 - 2 * brand.pad[0]) + '%';
            m.style.left = brand.pad[1] + '%';
            m.style.width = (100 - 2 * brand.pad[1]) + '%';
        }
        return m;
    }

    function initials(label) {
        var words = label.replace(/[^\w\s+]/g, ' ').trim().split(/\s+/);
        return (words[0] ? words[0][0] : '?') + (words[1] ? words[1][0] : '');
    }

    function hue(text) {
        var h = 0;
        for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
        return h;
    }

    // Square store icons (CANAL+, Nuvio…) carry their own background: filling the tile with the
    // colour at their left edge makes them read as one full-bleed logo instead of a box in a box.
    function edgeColour(img) {
        try {
            var c = document.createElement('canvas');
            c.width = c.height = 8;
            var g = c.getContext('2d');
            g.drawImage(img, 0, 0, 8, 8);
            var d = g.getImageData(0, 3, 1, 1).data;
            return d[3] > 200 ? 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')' : null;
        } catch (e) {
            return null; // canvas tainted by a file:// icon from another package
        }
    }

    // Installed apps report a native path; it may or may not be readable from a web app.
    function tryIcon(tile, mono, path) {
        var img = new Image();
        img.className = 'icon';
        img.onload = function () {
            mono.style.display = 'none';
            var edge = edgeColour(img);
            tile.style.background = edge || '#1a1d24';
            // An opaque square icon fills the tile edge to edge, so its own background (often a
            // gradient, like CANAL+) becomes the tile instead of a box sitting inside it.
            if (edge) img.className = 'icon full';
            tile.appendChild(img);
        };
        img.src = path.charAt(0) === '/' ? 'file://' + path : path;
    }

    function tileFace(item) {
        var tile = el('div', 'tile');
        if (item.brand) {
            tile.style.background = item.brand.bg;
            if (item.brand.text) {
                var word = el('div', 'wordmark', item.brand.text);
                word.style.color = item.brand.fg;
                tile.appendChild(word);
            } else {
                tile.appendChild(markEl(item.brand));
            }
        } else {
            tile.style.background = 'hsl(' + hue(item.label) + ',32%,24%)';
            var mono = el('div', 'mono', initials(item.label).toUpperCase());
            tile.appendChild(mono);
            if (item.iconPath) tryIcon(tile, mono, item.iconPath);
        }
        return tile;
    }

    function appTile(item) {
        var wrap = el('div', 'app' + (item.hidden ? ' is-hidden' : ''));
        wrap.appendChild(tileFace(item));
        wrap.appendChild(el('div', 'label', item.label));
        wrap._item = item;
        return wrap;
    }

    // Small tile used in Settings lists.
    function miniTile(item) {
        var wrap = el('div', 'mini');
        wrap.appendChild(tileFace(item));
        return wrap;
    }

    function allAppsTile() {
        var wrap = el('div', 'app');
        var tile = el('div', 'tile all-tile');
        tile.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/>' +
            '<rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/>' +
            '<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>';
        wrap.appendChild(tile);
        wrap.appendChild(el('div', 'label', t('All apps')));
        wrap._item = { kind: 'all' };
        return wrap;
    }

    function inputTile(input) {
        var brand = findBrand(input.brand || '') || findBrand({ name: input.label }) || { bg: '#2a2f3a', fg: '#fff', mark: null };
        var wrap = el('div', 'input');
        var tile = el('div', 'tile');
        tile.style.background = brand.bg;
        if (brand.mark) tile.appendChild(markEl(brand));
        var meta = el('div', 'meta');
        meta.appendChild(el('div', 'name', input.label));
        var port = el('div', 'port');
        var dot = el('span', 'dot');
        port.appendChild(dot);
        port.appendChild(document.createTextNode('HDMI ' + input.hdmi));
        meta.appendChild(port);
        tile.appendChild(meta);
        wrap.appendChild(tile);
        wrap._item = { kind: 'input', hdmi: input.hdmi, label: input.label, method: input.method };
        wrap._dot = dot;
        return wrap;
    }

    // Console tile for Settings lists: brand colours and logo only.
    function miniInputTile(input) {
        var brand = findBrand(input.brand || '') || findBrand({ name: input.label });
        return miniTile({ label: input.label, brand: brand && { key: brand.key, bg: brand.bg, fg: brand.fg, mark: brand.mark } });
    }

    // ---------- Home content

    // Consoles: edited list from Settings, else config.js.
    function inputs() {
        return Prefs.get().inputs || cfg.inputs || [];
    }

    function setInputs(list) {
        Prefs.get().inputs = list;
        Prefs.save();
        renderHome();
    }

    // Entries shown on Home: edited list from Settings, else config.js.
    function homeEntries() {
        return Prefs.get().home || cfg.apps || [];
    }

    function homeItems() {
        var items = Apps.curated(state.apps, { apps: homeEntries() });
        if (Prefs.get().appearance.order !== 'recent') return items;
        var recent = Prefs.get().recent;
        // Stable: apps never opened keep their manual order after the recent ones.
        return items.map(function (item, i) { return { item: item, i: i, t: recent[item.id] || 0 }; })
            .sort(function (a, b) { return (b.t - a.t) || (a.i - b.i); })
            .map(function (x) { return x.item; });
    }

    function setHomeItems(items) {
        Prefs.get().home = items.map(function (i) {
            var entry = { id: i.id, label: i.label };
            if (i.brand) entry.brand = i.brand.key;
            return entry;
        });
        Prefs.save();
        renderHome();
    }

    function renderHome() {
        var row = $('apps-row');
        row.innerHTML = '';
        var items = homeItems();
        if (!items.length) items = Apps.allSorted(state.apps, false, [], Prefs.get().hiddenApps).slice(0, 8);
        items.forEach(function (item) { row.appendChild(appTile(item)); });
        row.appendChild(allAppsTile());

        var row2 = $('inputs-row');
        row2.innerHTML = '';
        inputs().forEach(function (input) {
            if (!input.hidden) row2.appendChild(inputTile(input));
        });
        $('inputs-section').classList.toggle('hidden', !row2.children.length);
        applyInputStatus();
        if (UI.isVisible('home')) UI.refresh();
    }

    function applyInputStatus() {
        UI.children($('inputs-row')).forEach(function (tile) {
            tile._dot.classList.toggle('on', state.hdmi[tile._item.hdmi] === true);
        });
    }

    function refreshInputStatus() {
        if (!inputs().length) return;
        Inputs.hdmiStatus().then(function (status) {
            state.hdmi = status;
            applyInputStatus();
        }).catch(function (err) {
            log('Input status unavailable: ' + DevLog.errorText(err));
        });
    }

    function renderAll() {
        var grid = $('all-grid');
        grid.innerHTML = '';
        UI.resetScroll(grid);
        var items = Apps.allSorted(state.apps, state.showEverything, homeItems(), Prefs.get().hiddenApps);
        items.forEach(function (item) { grid.appendChild(appTile(item)); });
        $('all-count').textContent = t('{0} apps', items.length);
    }

    function renderLab() {
        var actions = [
            { label: 'Send installed app list to log', run: labDumpApps },
            { label: 'Read inputs', run: labReadInputs },
            { label: 'Open Samsung TV viewer only', run: function () { runLogged('Open TV viewer', Inputs.openViewer()); } }
        ];
        if (window.Sound) actions = actions.concat(Sound.actions());
        if (window.Weather) actions = actions.concat(Weather.actions());
        if (window.RenderProbe) actions = actions.concat(RenderProbe.actions());
        if (window.PlatformProbe) actions = actions.concat(PlatformProbe.actions());
        inputs().forEach(function (input) {
            var item = { kind: 'input', hdmi: input.hdmi, label: input.label };
            var name = input.label + ' (HDMI ' + input.hdmi + ')';
            actions.push({ label: name + ': switch + viewer', run: function () { openInput(item, 'switch+viewer'); } });
            actions.push({ label: name + ': switch only', run: function () { openInput(item, 'switch'); } });
            actions.push({ label: name + ': inside launcher', run: function () { openInput(item, 'inapp'); } });
        });
        var list = $('lab-list');
        list.innerHTML = '';
        actions.forEach(function (a) {
            var li = el('li', '', a.label);
            li._item = { kind: 'lab', run: a.run };
            list.appendChild(li);
        });
        DevLog.onLine(function () {
            $('lab-log').textContent = DevLog.lines().slice(-26).join('\n');
        });
    }

    // ---------- Actions

    function runLogged(what, promise) {
        log(what + '…');
        return promise.then(function (v) {
            log(what + ': ok');
            return v;
        }, function (err) {
            log(what + ': FAILED ' + DevLog.errorText(err));
            throw err;
        });
    }

    // Brief push-in on OK, like a physical button.
    function press(target) {
        if (!target) return;
        target.classList.add('pressed');
        setTimeout(function () { target.classList.remove('pressed'); }, 160);
    }

    function launchApp(item) {
        // Tizen 4 takes a few seconds to bring an app up; without this, OK looks like it did nothing.
        UI.toast(t('Opening {0}…', item.label));
        Prefs.get().recent[item.id] = Date.now();
        Prefs.save();
        var start = Prefs.get().returnHere
            ? Apps.launchReturning(item.id).catch(function (err) {
                log('Returning launch failed, plain launch instead: ' + DevLog.errorText(err));
                return Apps.launch(item.id);
            })
            : Apps.launch(item.id);
        runLogged('Launch ' + item.id, start).catch(function (err) {
            UI.toast(t('Could not open {0}: {1}', item.label, DevLog.errorText(err)));
        });
    }

    function openInput(item, method) {
        method = method || item.method || cfg.inputMethod;
        UI.toast(t('Switching to {0}…', item.label));
        runLogged('Input HDMI ' + item.hdmi + ' via ' + method, Inputs.open(item.hdmi, method)).then(function (result) {
            log('Current source now: ' + Inputs.describeSource(Inputs.current()));
            if (result === 'inapp') enterTvMode();
        }).catch(function (err) {
            UI.toast(t('Could not switch to {0}: {1}', item.label, DevLog.errorText(err)));
        });
    }

    function enterTvMode() {
        state.tvMode = true;
        document.documentElement.classList.add('tv-mode');
    }

    function exitTvMode() {
        state.tvMode = false;
        document.documentElement.classList.remove('tv-mode');
        Inputs.hide().catch(function (err) { log('Hide input failed: ' + DevLog.errorText(err)); });
    }

    function labDumpApps() {
        runLogged('App list', Apps.getInstalledApps()).then(function (apps) {
            log('apps: ' + apps.length + ' total, ' + apps.filter(function (a) { return a.show; }).length + ' with show=true',
                apps.map(Apps.describe));
            UI.toast('Sent ' + apps.length + ' apps to the log');
        }).catch(function () {});
    }

    function labReadInputs() {
        runLogged('Inputs', Inputs.sources()).then(function (info) {
            var fmt = function (list) { return (list || []).map(Inputs.describeSource).join(', ') || 'none'; };
            log('connected: ' + fmt(info.connected));
            log('disconnected: ' + fmt(info.disconnected));
            log('current: ' + Inputs.describeSource(Inputs.current()));
        }).catch(function () {});
    }

    function nextWallpaper() {
        var w = Wallpaper.next();
        if (w) UI.toast(w.title + (w.credit ? ' · ' + w.credit : ''));
    }

    // Colour keys are hidden shortcuts; everything is also reachable from Settings.
    // Green in All apps: hide the focused app from All apps (or show it again under Yellow).
    function allAppsMenu() {
        var focused = document.querySelector('#all-grid .focused');
        var item = focused && focused._item;
        if (!item) return;
        var hidden = Prefs.get().hiddenApps;
        var set = function (hide) {
            var i = hidden.indexOf(item.id);
            if (hide && i < 0) hidden.push(item.id);
            if (!hide && i >= 0) hidden.splice(i, 1);
            Prefs.save();
            UI.show('all', { back: true });
            UI.toast(t(hide ? '{0} hidden' : '{0} shown again', item.label));
            listeners.forEach(function (fn) { fn(); });
        };
        UI.menu(item.label, [
            item.hidden
                ? { label: 'Show in All apps', run: function () { set(false); } }
                : { label: 'Hide from All apps', run: function () { set(true); } },
            { label: 'Cancel' }
        ]);
    }

    function colourKey(k, view) {
        if (k === KEY.RED || k === KEY.R) {
            UI.show(view === 'all' ? 'home' : 'all');
        } else if (k === KEY.GREEN || k === KEY.G) {
            if (view === 'home') nextWallpaper();
            else if (view === 'all') allAppsMenu();
        } else if (k === KEY.BLUE || k === KEY.B) {
            UI.show(view === 'lab' ? 'home' : 'lab');
        } else if (k === KEY.YELLOW || k === KEY.Y) {
            if (view === 'all') {
                state.showEverything = !state.showEverything;
                UI.show('all', { back: true });
                UI.refreshHints();
            } else if (view === 'home' && window.RunnerGame) {
                RunnerGame.open();
            } else return false;
        } else {
            return false;
        }
        return true;
    }

    // ---------- Clock, data, lifecycle

    function updateClock() {
        var d = new Date();
        var clock = Appearance.time(d);
        $('time-main').textContent = clock.time;
        $('time-suffix').textContent = clock.suffix;
        $('date').textContent = Appearance.date(d);
        renderWeather();
    }

    // Same rule as the screen saver: no usable reading, no widget.
    function renderWeather() {
        var w = Weather.current();
        $('home-wx').classList.toggle('hidden', !w);
        if (!w) return;
        $('home-wx-icon').innerHTML = w.icon;
        $('home-wx-temp').textContent = w.temp;
        $('home-wx-detail').textContent = w.detail;
    }

    // The TV takes ~4 s to list its ~450 apps, so Home is drawn from the last list we saw
    // and only redrawn if a fresh list differs.
    function readCache() {
        try {
            return JSON.parse(localStorage.getItem(CACHE_KEY));
        } catch (e) {
            return null;
        }
    }

    function writeCache(apps) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(apps));
        } catch (e) {
            // Without the cache we only lose the fast start.
        }
    }

    var listeners = [];
    /*
     * Hidden game code: Left and Right alternating three times.
     *
     * Two properties matter on a remote. It is matched against the tail of the last few keys,
     * not with a position counter, because a held key repeats and one extra press would
     * otherwise reset progress so the code could never complete. And it alternates rather than
     * repeating a key, because both auto-repeat and sweeping along a row produce runs of the
     * same key — a code made of runs fires by accident during ordinary browsing.
     */
    var gameCode = [KEY.LEFT, KEY.RIGHT, KEY.LEFT, KEY.RIGHT, KEY.LEFT, KEY.RIGHT];
    var recentKeys = [];

    function gameCodeEntered(k) {
        recentKeys.push(k);
        if (recentKeys.length > gameCode.length) recentKeys.shift();
        if (recentKeys.length < gameCode.length) return false;
        for (var i = 0; i < gameCode.length; i++) {
            if (recentKeys[i] !== gameCode[i]) return false;
        }
        recentKeys.length = 0;
        return true;
    }

    function setApps(apps) {
        var sig = apps.map(function (a) { return a.id + '|' + a.name + '|' + a.show; }).join(',');
        if (sig === state.appsSig) return;
        state.appsSig = sig;
        state.apps = apps;
        renderHome();
        if (UI.isVisible('all')) UI.show('all', { back: true });
        listeners.forEach(function (fn) { fn(); });
    }

    function loadApps() {
        state.lastFetch = Date.now();
        return Apps.getInstalledApps().then(function (apps) {
            var list = Apps.launchable(apps).map(function (a) {
                return { id: a.id, name: a.name, show: a.show, iconPath: a.iconPath || '' };
            });
            writeCache(list);
            setApps(list);
        }).catch(function (err) {
            UI.toast(t('Could not list apps: {0}', DevLog.errorText(err)));
            log('App list failed: ' + DevLog.errorText(err));
        });
    }

    function registerKeys() {
        try {
            tizen.tvinputdevice.registerKeyBatch(['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue']);
        } catch (e) {
            log('Colour keys unavailable: ' + DevLog.errorText(e));
        }
    }

    function registerViews() {
        UI.register('home', {
            el: $('home'),
            startRow: 1,
            hints: [['OK', 'Open'], ['▲', 'Settings']],
            rows: function () {
                return [[$('gear')], UI.children($('apps-row')), UI.children($('inputs-row'))];
            },
            activate: function (item, target) {
                press(target);
                if (item.kind === 'app') launchApp(item);
                else if (item.kind === 'all') UI.show('all');
                else if (item.kind === 'input') openInput(item);
                else if (item.kind === 'settings') UI.show('settings');
            },
            // Home is the root: Back does nothing.
            onBack: function () { return true; }
        });
        $('gear')._item = { kind: 'settings' };

        UI.register('all', {
            el: $('all'),
            rows: function () { return UI.chunk(UI.children($('all-grid')), GRID_COLS); },
            onShow: renderAll,
            activate: launchApp,
            hints: function () {
                return [['OK', 'Open'], ['Green', 'Options'],
                    ['Yellow', state.showEverything ? 'Usual apps' : 'Everything'], ['Back', 'Home']];
            }
        });

        UI.register('lab', {
            el: $('lab'),
            rows: function () { return UI.children($('lab-list')).map(function (li) { return [li]; }); },
            activate: function (item) { item.run(); },
            hints: [['OK', 'Run'], ['Back', 'Home']]
        });
    }

    function init() {
        registerKeys();
        registerViews();
        UI.setColourKey(colourKey);
        UI.setKeyHook(function (k) {
            if (state.tvMode) {
                if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) exitTvMode();
                return true;
            }
            if (!UI.isVisible('home')) { recentKeys.length = 0; return false; }
            if (gameCodeEntered(k)) {
                if (window.RunnerGame) RunnerGame.open(true);
                return true;
            }
            return false;
        });
        Appearance.apply();
        updateClock();
        // Nothing to draw while another app is in front (background-support keeps us running).
        setInterval(function () { if (!document.hidden) updateClock(); }, 10000);
        Weather.onUpdate(renderWeather);
        renderLab();
        var cached = readCache();
        if (cached && cached.length) setApps(cached);
        else renderHome();
        UI.show('home');
        Wallpaper.start();

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                if (state.tvMode) exitTvMode();
                return;
            }
            updateClock();
            Weather.refresh();
            // Recent order: the app just closed moves to the front, and focus goes with it.
            if (Prefs.get().appearance.order === 'recent' && UI.isVisible('home')) {
                renderHome();
                var first = $('apps-row').firstChild;
                if (first) {
                    UI.resetScroll($('apps-row'));
                    UI.focusOn(first);
                }
            }
            refreshInputStatus();
            if (UI.isVisible('home')) Wallpaper.homeShown();
            if (Date.now() - state.lastFetch > REFRESH_AFTER_MS) setTimeout(loadApps, 1500);
        });
        // With a cache, let the first frames and key presses through before the slow app list.
        setTimeout(loadApps, cached ? 2000 : 0);
        refreshInputStatus();
        log('Launcher started');
    }

    window.Home = {
        init: init,
        apps: function () { return state.apps; },
        homeItems: homeItems,
        setHomeItems: setHomeItems,
        inputs: inputs,
        setInputs: setInputs,
        hdmiStatus: function () { return state.hdmi; },
        // An HDMI input shown inside the launcher: no screen saver over it.
        tvMode: function () { return state.tvMode; },
        refreshInputStatus: refreshInputStatus,
        renderLab: renderLab,
        updateClock: updateClock,
        render: renderHome,
        reloadApps: loadApps,
        miniTile: miniTile,
        miniInputTile: miniInputTile,
        onAppsChanged: function (fn) { listeners.push(fn); }
    };
})();
