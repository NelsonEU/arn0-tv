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

    // Brand fills as glass: keep hue, let the wallpaper show through.
    function hexToRgba(hex, alpha) {
        var h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length !== 6) return 'rgba(255,255,255,' + alpha + ')';
        var n = parseInt(h, 16);
        return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }

    function glassBg(bg, alpha) {
        alpha = alpha == null ? 0.46 : alpha;
        if (!bg) return 'rgba(255,255,255,0.12)';
        return String(bg)
            .replace(/#([0-9a-fA-F]{3,6})\b/g, function (_, h) { return hexToRgba(h, alpha); })
            .replace(/hsl\(([^)]+)\)/g, function (_, body) { return 'hsla(' + body + ',' + alpha + ')'; });
    }

    var ICON_PX = 192;

    /*
     * Many Tizen icons ship with empty transparent margins. Crop to opaque pixels so the
     * artwork fills the tile without a per-app pad. Box icons (a solid rectangle with partly
     * transparent edges) have their background cleared, so the tile shows through.
     */
    // Clears the background colour of a box icon, starting from the edges so the logo stays.
    function clearBackground(canvas, bgR, bgG, bgB) {
        var w = canvas.width;
        var h = canvas.height;
        var out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        var octx = out.getContext('2d');
        octx.drawImage(canvas, 0, 0);
        var clearData = octx.getImageData(0, 0, w, h);
        var cd = clearData.data;
        var visited = new Uint8Array(w * h);
        var stack = [];
        var seed = function (q) {
            if (!visited[q] && cd[q * 4 + 3] > 0) {
                visited[q] = 1;
                stack.push(q);
            }
        };
        var bx;
        var by;
        for (bx = 0; bx < w; bx++) {
            seed(bx);
            seed((h - 1) * w + bx);
        }
        for (by = 0; by < h; by++) {
            seed(by * w);
            seed(by * w + w - 1);
        }
        while (stack.length) {
            var q = stack.pop();
            var o = q * 4;
            if (Math.abs(cd[o] - bgR) >= 60 || Math.abs(cd[o + 1] - bgG) >= 60 || Math.abs(cd[o + 2] - bgB) >= 60) continue;
            cd[o + 3] = 0;
            var qx = q % w;
            if (qx > 0) seed(q - 1);
            if (qx < w - 1) seed(q + 1);
            if (q >= w) seed(q - w);
            if (q < w * (h - 1)) seed(q + w);
        }
        octx.putImageData(clearData, 0, 0);
        try {
            return out.toDataURL('image/png');
        } catch (e) {
            return null;
        }
    }

    function trimIconPadding(img, done) {
        var sw = img.naturalWidth;
        var sh = img.naturalHeight;
        if (!sw || !sh) { done(null); return; }
        // Tiles are small, so work on a copy at most ICON_PX wide: much cheaper to process.
        var scale = Math.min(1, ICON_PX / Math.max(sw, sh));
        var w = Math.max(1, Math.round(sw * scale));
        var h = Math.max(1, Math.round(sh * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        if (!ctx) { done(null); return; }
        try {
            ctx.drawImage(img, 0, 0, w, h);
            var data = ctx.getImageData(0, 0, w, h).data;
        } catch (e) {
            done(null);
            return;
        }
        var minX = w;
        var minY = h;
        var maxX = -1;
        var maxY = -1;
        var i;
        for (i = 3; i < data.length; i += 4) {
            if (data[i] < 12) continue;
            var p = (i - 3) / 4;
            var x = p % w;
            var y = (p - x) / w;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        if (maxX < 0) { done(null); return; }
        // Box icon: all four corners are partly visible.
        var isBox = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].every(function (c) {
            return data[(c[1] * w + c[0]) * 4 + 3] >= 40;
        });
        // Solid area bounds, and the artwork's background colour sampled just inside its edges.
        var sx0 = w;
        var sy0 = h;
        var sx1 = -1;
        var sy1 = -1;
        for (i = 3; i < data.length; i += 4) {
            if (data[i] < 200) continue;
            var q = (i - 3) / 4;
            var qx = q % w;
            var qy = (q - qx) / w;
            if (qx < sx0) sx0 = qx;
            if (qy < sy0) sy0 = qy;
            if (qx > sx1) sx1 = qx;
            if (qy > sy1) sy1 = qy;
        }
        var sum = [0, 0, 0];
        var n = 0;
        if (sx1 >= 0) {
            var bw = sx1 - sx0 + 1;
            var bh = sy1 - sy0 + 1;
            for (i = 3; i < data.length; i += 4) {
                if (data[i] < 200) continue;
                var p2 = (i - 3) / 4;
                var px2 = p2 % w;
                var py2 = (p2 - px2) / w;
                var edge = px2 < sx0 + bw * 0.08 || px2 > sx1 - bw * 0.08 ||
                    py2 < sy0 + bh * 0.08 || py2 > sy1 - bh * 0.08;
                if (!edge) continue;
                sum[0] += data[i - 3];
                sum[1] += data[i - 2];
                sum[2] += data[i - 1];
                n++;
            }
        }
        if (isBox && n) {
            done(clearBackground(canvas, sum[0] / n, sum[1] / n, sum[2] / n));
            return;
        }
        var margin = Math.max(1, Math.round(Math.max(w, h) * 0.02));
        minX = Math.max(0, minX - margin);
        minY = Math.max(0, minY - margin);
        maxX = Math.min(w - 1, maxX + margin);
        maxY = Math.min(h - 1, maxY + margin);
        var cw = maxX - minX + 1;
        var ch = maxY - minY + 1;
        if (cw / w > 0.9 && ch / h > 0.9) { done(null); return; }
        var out = document.createElement('canvas');
        out.width = cw;
        out.height = ch;
        out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
        try {
            done(out.toDataURL('image/png'));
        } catch (e2) {
            done(null);
        }
    }

    // Processed icons are kept for the session, so each one is only drawn to a canvas once.
    var iconCache = {};

    // Installed apps report a native path; it may or may not be readable from a web app.
    // pad: optional [vertical, horizontal] inset % override after auto-trim.
    function tryIcon(tile, mono, path, pad) {
        var img = new Image();
        img.className = 'icon';
        if (iconCache[path]) img._ready = true;
        if (pad) {
            img.style.top = pad[0] + '%';
            img.style.height = (100 - 2 * pad[0]) + '%';
            img.style.left = pad[1] + '%';
            img.style.width = (100 - 2 * pad[1]) + '%';
        }
        img.onload = function () {
            if (img._ready) {
                mono.style.display = 'none';
                if (!img.parentNode) tile.appendChild(img);
                return;
            }
            trimIconPadding(img, function (url) {
                img._ready = true;
                iconCache[path] = url || img.src;
                if (url) img.src = url;
                else {
                    mono.style.display = 'none';
                    tile.appendChild(img);
                }
            });
        };
        img.src = iconCache[path] || (path.charAt(0) === '/' ? 'file://' + path : path);
    }

    function tileFace(item) {
        var tile = el('div', 'tile');
        if (item.brand) {
            tile.style.background = glassBg(item.brand.bg);
            if (item.brand.text) {
                var word = el('div', 'wordmark', item.brand.text);
                word.style.color = item.brand.fg;
                tile.appendChild(word);
            } else {
                tile.appendChild(markEl(item.brand));
            }
        } else {
            tile.style.background = glassBg('hsl(' + hue(item.label) + ',32%,28%)');
            var mono = el('div', 'mono', initials(item.label).toUpperCase());
            tile.appendChild(mono);
            if (item.iconPath) tryIcon(tile, mono, item.iconPath, item.iconPad);
        }
        return tile;
    }

    function appTile(item) {
        var wrap = el('div', 'app');
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
        wrap.appendChild(el('div', 'label', 'All apps'));
        wrap._item = { kind: 'all' };
        return wrap;
    }

    function inputTile(input) {
        var brand = findBrand(input.brand || '') || { bg: '#2a2f3a', fg: '#fff', mark: null };
        var wrap = el('div', 'input');
        var tile = el('div', 'tile');
        tile.style.background = glassBg(brand.bg, 0.38);
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
        var brand = findBrand(input.brand || '');
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
        return Apps.curated(state.apps, { apps: homeEntries() });
    }

    function setHomeItems(items) {
        Prefs.get().home = items.map(function (i) {
            var entry = { id: i.id, label: i.label };
            if (i.brand) entry.brand = i.brand.key;
            if (i.iconPad) entry.iconPad = i.iconPad;
            return entry;
        });
        Prefs.save();
        renderHome();
    }

    function renderHome() {
        var row = $('apps-row');
        row.innerHTML = '';
        var items = homeItems();
        if (!items.length) items = Apps.allSorted(state.apps, false).slice(0, 8);
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
        var items = Apps.allSorted(state.apps, state.showEverything);
        items.forEach(function (item) { grid.appendChild(appTile(item)); });
        $('all-count').textContent = items.length + ' apps';
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

    function launchApp(item) {
        runLogged('Launch ' + item.id, Apps.launch(item.id)).catch(function (err) {
            UI.toast('Could not open ' + item.label + ': ' + DevLog.errorText(err));
        });
    }

    function openInput(item, method) {
        method = method || item.method || cfg.inputMethod;
        UI.toast('Switching to ' + item.label + '…');
        runLogged('Input HDMI ' + item.hdmi + ' via ' + method, Inputs.open(item.hdmi, method)).then(function (result) {
            log('Current source now: ' + Inputs.describeSource(Inputs.current()));
            if (result === 'inapp') enterTvMode();
        }).catch(function (err) {
            UI.toast('Could not switch to ' + item.label + ': ' + DevLog.errorText(err));
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
        Wallpaper.next(function (w) {
            if (w) UI.toast(w.title + (w.credit ? ' · ' + w.credit : ''));
        });
    }

    // Colour keys are hidden shortcuts; everything is also reachable from Settings.
    function colourKey(k, view) {
        if (k === KEY.RED || k === KEY.R) {
            UI.show(view === 'all' ? 'home' : 'all');
        } else if (k === KEY.GREEN || k === KEY.G) {
            if (view === 'home') nextWallpaper();
        } else if (k === KEY.BLUE || k === KEY.B) {
            UI.show(view === 'lab' ? 'home' : 'lab');
        } else if (k === KEY.YELLOW || k === KEY.Y) {
            if (view === 'all') {
                state.showEverything = !state.showEverything;
                UI.show('all', { back: true });
            } else return false;
        } else {
            return false;
        }
        return true;
    }

    // ---------- Clock, data, lifecycle

    function updateClock() {
        var d = new Date();
        var t = Appearance.time(d);
        $('time-main').textContent = t.time;
        $('time-suffix').textContent = t.suffix;
        $('date').textContent = Appearance.date(d);
    }

    function updateWeather() {
        var el = $('home-weather');
        var clock = document.querySelector('#home .clock');
        var sep = $('home-music-sep');
        if (!el) return;
        var w = window.Weather && Weather.current();
        el.classList.toggle('hidden', !w);
        if (clock) clock.classList.toggle('with-weather', !!w);
        if (sep) {
            sep.classList.toggle('hidden', !(w && clock && clock.classList.contains('with-music')));
        }
        if (!w) return;
        $('home-wx-icon').innerHTML = w.icon;
        $('home-wx-temp').textContent = w.temp;
        $('home-wx-range').textContent = w.range;
        $('home-wx-detail').textContent = w.detail;
        var week = $('home-wx-week');
        week.innerHTML = '';
        (w.days || []).forEach(function (d) {
            var day = document.createElement('div');
            day.className = 'home-wx-day';
            day.innerHTML =
                '<div class="home-wx-day-label"></div>' +
                '<div class="home-wx-day-icon"></div>' +
                '<div class="home-wx-day-temps"></div>';
            day.querySelector('.home-wx-day-label').textContent = d.label;
            day.querySelector('.home-wx-day-icon').innerHTML = d.icon;
            day.querySelector('.home-wx-day-temps').innerHTML =
                d.max + ' <span>' + d.min + '</span>';
            week.appendChild(day);
        });
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
            UI.toast('Could not list apps: ' + DevLog.errorText(err));
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
            hints: function () {
                return [['OK', 'Open'], ['▲', 'Settings']];
            },
            rows: function () {
                var top = [$('gear')];
                if (window.Music && Music.barVisible()) {
                    top = [$('music-btn-play'), $('music-btn-next'), $('gear')];
                }
                return [top, UI.children($('apps-row')), UI.children($('inputs-row'))];
            },
            activate: function (item) {
                if (item.kind === 'app') launchApp(item);
                else if (item.kind === 'all') UI.show('all');
                else if (item.kind === 'input') openInput(item);
                else if (item.kind === 'settings') UI.show('settings');
                else if (item.kind === 'music') {
                    if (item.action === 'toggle') Music.toggle();
                    else if (item.action === 'next') Music.next();
                }
            },
            // Home is the root: Back does nothing.
            onBack: function () { return true; },
            onFocus: function (el) {
                if (window.Music && (el === $('music-btn-play') || el === $('music-btn-next'))) Music.showFull();
            }
        });
        $('gear')._item = { kind: 'settings' };

        UI.register('all', {
            el: $('all'),
            rows: function () { return UI.chunk(UI.children($('all-grid')), GRID_COLS); },
            onShow: renderAll,
            activate: launchApp,
            hints: [['OK', 'Open'], ['Back', 'Home']]
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
            return false;
        });
        Appearance.apply();
        updateClock();
        updateWeather();
        setInterval(updateClock, 10000);
        if (window.Weather) {
            Weather.onUpdate(updateWeather);
            Weather.refresh();
        }
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
            updateWeather();
            if (window.Weather) Weather.refresh();
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
        reloadApps: loadApps,
        miniTile: miniTile,
        miniInputTile: miniInputTile,
        onAppsChanged: function (fn) { listeners.push(fn); }
    };
})();
