/* Settings: overview, Background, Apps on Home, Consoles, Appearance, Samsung, Advanced. */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var KEY = UI.KEY;
    var t = I18n.t;
    var THUMB_COLS = 6;

    // Samsung's on-screen keyboard (IME) sends these for its Done / Cancel buttons.
    var IME_DONE = 65376;
    var IME_CANCEL = 65385;

    // Samsung's own home screen (Smart Hub); TV settings are one press away from there.
    // Opening com.samsung.tv.coba.setting directly does not work on the Q70B: a plain launch
    // fails (UnknownError) and app controls are accepted but show nothing.
    var SAMSUNG_HOME = 'com.samsung.tv.csfs';

    var LOGOS = [
        { key: 'playstation', label: 'PlayStation' },
        { key: 'xbox', label: 'Xbox' },
        { key: 'switch', label: 'Nintendo Switch' },
        { key: 'chromecast', label: 'Chromecast' },
        { key: '', label: 'None' }
    ];

    var METHODS = [
        { key: 'switch+viewer', label: 'TV input', hint: 'Game Mode works' },
        { key: 'inapp', label: 'Inside the launcher', hint: 'Back returns here' }
    ];

    // ---------- Generic list pages

    // entries: [{ label, value, mini, run }]
    function renderList(list, entries) {
        list.innerHTML = '';
        entries.forEach(function (e) {
            var li = el('li', 'setting-row');
            if (e.mini) li.appendChild(e.mini);
            li.appendChild(el('span', 'setting-label', t(e.label)));
            li.appendChild(el('span', 'setting-value', t(e.value || '')));
            li._item = e;
            list.appendChild(li);
        });
    }

    /*
     * A two-column list fills the first column before the second, so visual row r holds items
     * r and r + rowCount. The focus grid has to be built that way round or Down would jump
     * across columns.
     */
    function columnRows(items) {
        var rowCount = Math.ceil(items.length / 2);
        var rows = [];
        for (var r = 0; r < rowCount; r++) {
            var row = [items[r]];
            if (items[r + rowCount]) row.push(items[r + rowCount]);
            rows.push(row);
        }
        return rows;
    }

    function registerList(name, entries, hints, twoColumn) {
        var view = $(name);
        var list = view.querySelector('ul');
        var render = function () {
            renderList(list, entries());
            // Set in JS so the split follows the number of entries rather than a hard-coded four.
            if (twoColumn) {
                list.style.gridTemplateRows =
                    'repeat(' + Math.ceil(list.children.length / 2) + ', auto)';
            }
        };
        UI.register(name, {
            el: view,
            rows: function () {
                var items = UI.children(list);
                return twoColumn ? columnRows(items) : items.map(function (li) { return [li]; });
            },
            onShow: render,
            activate: function (item) { item.run(); },
            hints: hints
        });
        return render;
    }

    var opening = false;
    function openSamsungHome() {
        if (opening) return;
        opening = true;
        DevLog.log('Open Samsung Home');
        Apps.launch(SAMSUNG_HOME).catch(function (err) {
            DevLog.log('Samsung Home failed: ' + DevLog.errorText(err));
            UI.toast(t('Could not open Samsung Home: {0}', DevLog.errorText(err)));
        }).then(function () { opening = false; });
    }

    // ---------- Overview

    function wallpaperSummary() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') return 'Off';
        if (p.mode === 'rotate') {
            return t(p.source === 'online' ? 'Online' : 'Rotate') + ' · ' + t(Wallpaper.interval(p.interval).label).toLowerCase();
        }
        var w = Wallpaper.find(p.photo);
        return w ? w.title : 'Photo';
    }

    function overviewEntries() {
        var a = Prefs.get().appearance;
        var shown = Home.inputs().filter(function (i) { return !i.hidden; }).length;
        return [
            { label: 'Background', value: wallpaperSummary(), run: function () { UI.show('bg'); } },
            { label: 'Apps on Home', value: t('{0} apps', Home.homeItems().length), run: function () { UI.show('homeapps'); } },
            { label: 'Consoles', value: t('{0} on Home', shown), run: function () { UI.show('consoles'); } },
            { label: 'Appearance', value: Appearance.font(a.font).label + ' · ' + t(a.clock === '12h' ? '12-hour' : '24-hour'), run: function () { UI.show('appearance'); } },
            { label: 'Weather', value: weatherSummary(), run: weatherMenu },
            { label: 'Navigation sound', value: soundSummary(), run: function () { UI.show('sound-settings'); } },
            { label: 'Screen saver', value: screensaverSummary(), run: function () { UI.show('screensaver-settings'); } },
            { label: 'Samsung Home', value: 'Smart Hub and TV settings', run: openSamsungHome },
            { label: 'Advanced', value: 'Refresh, reset, Lab', run: function () { UI.show('advanced'); } }
        ];
    }

    // ---------- Chips (Background, Appearance)

    function chip(label, on, item) {
        var c = el('div', 'chip' + (on ? ' on' : ''), t(label));
        c._item = item;
        return c;
    }

    function chipRows(container) {
        var rows = [];
        UI.children(container).forEach(function (block) {
            if (block.classList.contains('hidden')) return;
            var chips = block.querySelector('.chips, .thumbs');
            if (!chips) return;
            if (chips.classList.contains('thumbs')) rows = rows.concat(UI.chunk(UI.children(chips), THUMB_COLS));
            else rows.push(UI.children(chips));
        });
        return rows;
    }

    // ---------- Background

    function renderBackground() {
        var p = Prefs.get().wallpaper;

        var modes = $('bg-mode');
        modes.innerHTML = '';
        [['off', 'Off'], ['photo', 'Photo'], ['rotate', 'Rotate']].forEach(function (m) {
            modes.appendChild(chip(m[1], p.mode === m[0], { kind: 'mode', key: m[0] }));
        });

        var sources = $('bg-source');
        sources.innerHTML = '';
        [['builtin', 'Built-in'], ['online', 'Online, always new']].forEach(function (s) {
            sources.appendChild(chip(s[1], p.source === s[0], { kind: 'source', key: s[0] }));
        });
        $('bg-source-block').classList.toggle('hidden', p.mode === 'off');

        var intervals = $('bg-interval');
        intervals.innerHTML = '';
        Wallpaper.INTERVALS.forEach(function (i) {
            intervals.appendChild(chip(i.label, p.interval === i.key, { kind: 'interval', key: i.key }));
        });
        $('bg-interval-block').classList.toggle('hidden', p.mode !== 'rotate');

        var photos = $('bg-photos');
        photos.innerHTML = '';
        Wallpaper.list().forEach(function (w) {
            var thumb = el('div', 'thumb' + (p.photo === w.key ? ' on' : ''));
            var img = new Image();
            img.src = w.thumb;
            thumb.appendChild(img);
            thumb.appendChild(el('div', 'thumb-title', w.title));
            thumb._item = { kind: 'photo', key: w.key };
            photos.appendChild(thumb);
        });
        $('bg-photos-block').classList.toggle('hidden', p.mode !== 'photo');
    }

    function activateBackground(item) {
        var p = Prefs.get().wallpaper;
        if (item.kind === 'mode') {
            p.mode = item.key;
            if (item.key === 'rotate') p.lastChange = Date.now();
        } else if (item.kind === 'interval') {
            p.interval = item.key;
            p.lastChange = Date.now();
        } else if (item.kind === 'photo') {
            p.photo = item.key;
        } else if (item.kind === 'source') {
            p.source = item.key;
            if (item.key === 'online') {
                UI.toast('Fetching new photos…');
                OnlineWallpapers.fill();
            }
        }
        Prefs.save();
        Wallpaper.apply();
        renderBackground();
        UI.refresh();
    }

    // ---------- Appearance

    function appearanceBlocks() {
        return [
            { title: 'Clock', key: 'clock', options: [['24h', '24-hour'], ['12h', '12-hour']] },
            { title: 'Date', key: 'showDate', options: [[true, 'Show'], [false, 'Hide']] },
            { title: 'Language', key: 'locale', options: Appearance.LOCALES.map(function (l) { return [l.key, l.label]; }) },
            { title: 'Font', key: 'font', options: Appearance.FONTS.map(function (f) { return [f.key, f.label, f.family]; }) },
            { title: 'App names', key: 'names', options: [['always', 'Always'], ['focused', 'When selected'], ['never', 'Never']] },
            { title: 'Style', key: 'style', options: [['original', 'Original'], ['tvos', 'tvOS']] },
            { title: 'App order', key: 'order', options: [['manual', 'Manual'], ['recent', 'Recent first']] },
            { title: 'Weather on Home', key: 'homeWeather', options: [[true, 'Show'], [false, 'Hide']] }
        ];
    }

    function renderAppearance() {
        var p = Prefs.get().appearance;
        var body = $('appearance-body');
        body.innerHTML = '';
        appearanceBlocks().forEach(function (b) {
            var block = el('div', 'setting-block');
            block.appendChild(el('h2', '', t(b.title)));
            var chips = el('div', 'chips');
            b.options.forEach(function (o) {
                var c = chip(o[1], p[b.key] === o[0], { key: b.key, value: o[0] });
                if (o[2]) c.style.fontFamily = o[2];
                chips.appendChild(c);
            });
            block.appendChild(chips);
            body.appendChild(block);
        });
    }

    function activateAppearance(item) {
        Prefs.get().appearance[item.key] = item.value;
        Prefs.save();
        Appearance.apply();
        Home.updateClock();
        if (item.key === 'order' || item.key === 'locale') Home.render();
        if (item.key === 'locale') UI.refreshHints();
        renderAppearance();
        UI.refresh();
    }

    // ---------- Weather

    var renderOverview = null;
    var renderAdvanced = null;

    function weatherSummary() {
        var w = Prefs.get().weather;
        if (!Weather.configured()) return 'Off';
        return (w.city || t('Custom location')) + ' · ' + (w.unit === 'fahrenheit' ? '°F' : '°C');
    }

    function weatherChanged() {
        renderOverview();
        UI.refresh();
    }

    function weatherMenu() {
        var w = Prefs.get().weather;
        var options = [
            {
                label: Weather.configured() ? t('Change city') + ' · ' + (w.city || t('Custom location')) : 'Choose a city',
                run: askCity
            },
            {
                label: t('Unit') + ' · ' + (w.unit === 'fahrenheit' ? '°F' : '°C'), run: function () {
                    UI.menu('Unit', [['celsius', 'Celsius (°C)'], ['fahrenheit', 'Fahrenheit (°F)']].map(function (u) {
                        return {
                            label: u[1],
                            checked: (w.unit || 'celsius') === u[0],
                            run: function () { Weather.setUnit(u[0]); weatherChanged(); }
                        };
                    }));
                }
            }
        ];
        if (Weather.configured()) {
            options.push({ label: 'Turn weather off', run: function () { Weather.setPlace(null); weatherChanged(); } });
        }
        options.push({ label: 'Cancel' });
        UI.menu('Weather', options);
    }

    // Typed with the TV's keyboard, then picked from Open-Meteo's matches.
    function askCity() {
        rename(Prefs.get().weather.city || '', function (name) {
            UI.toast(t('Searching for “{0}”…', name));
            Weather.search(name).then(function (places) {
                if (!places.length) {
                    UI.toast(t('No city found for “{0}”', name));
                    return;
                }
                UI.menu('Which city?', places.map(function (p) {
                    return {
                        label: p.name + (p.detail ? ' · ' + p.detail : ''),
                        run: function () {
                            Weather.setPlace(p);
                            weatherChanged();
                            UI.toast(t('Weather: {0}', p.name));
                        }
                    };
                }).concat([{ label: 'Cancel' }]));
            }).catch(function (err) {
                UI.toast(t('Search failed: {0}', DevLog.errorText(err)));
            });
        }, 'City');
    }

    // ---------- Navigation sound

    function soundSummary() {
        var p = Prefs.get().sound;
        return p.enabled ? t('On') + ' · ' + t(Sound.presetLabel()) : 'Off';
    }

    function renderSound() {
        var p = Prefs.get().sound;
        var body = $('sound-body');
        body.innerHTML = '';

        var enabledBlock = el('div', 'setting-block');
        enabledBlock.appendChild(el('h2', '', t('Sound')));
        var enabledChips = el('div', 'chips');
        enabledChips.appendChild(chip('On', p.enabled, { kind: 'enabled', value: true }));
        enabledChips.appendChild(chip('Off', !p.enabled, { kind: 'enabled', value: false }));
        enabledBlock.appendChild(enabledChips);
        body.appendChild(enabledBlock);

        var presetBlock = el('div', 'setting-block');
        presetBlock.appendChild(el('h2', '', t('Style')));
        var presetChips = el('div', 'chips');
        Sound.presetOptions().forEach(function (preset) {
            presetChips.appendChild(chip(preset.label, p.preset === preset.key,
                { kind: 'preset', value: preset.key }));
        });
        presetBlock.appendChild(presetChips);
        body.appendChild(presetBlock);

        var previewBlock = el('div', 'setting-block');
        previewBlock.appendChild(el('h2', '', t('Try it')));
        var previewChips = el('div', 'chips');
        previewChips.appendChild(chip('Preview selected sound', false, { kind: 'preview' }));
        previewBlock.appendChild(previewChips);
        body.appendChild(previewBlock);
    }

    function activateSound(item) {
        var p = Prefs.get().sound;
        if (item.kind === 'enabled') {
            p.enabled = item.value;
            Prefs.save();
            renderSound();
            UI.refresh();
            if (p.enabled) Sound.preview();
            return;
        }
        if (item.kind === 'preset') {
            p.preset = item.value;
            Prefs.save();
            renderSound();
            UI.refresh();
            Sound.preview();
            return;
        }
        if (item.kind === 'preview') Sound.preview();
    }

    // ---------- Screen saver

    function screensaverSummary() {
        var p = Prefs.get().screensaver;
        return p.enabled ? t('After {0}', t(Screensaver.delay().label)) : 'Off';
    }

    /*
     * "Change photo" only means something while the Background is on Rotate: with a single
     * photo the screen saver holds it, exactly as Home does.
     */
    function screensaverBlocks() {
        var blocks = [
            { title: 'Screen saver', key: 'enabled', options: [[true, 'On'], [false, 'Off']] },
            { title: 'Start after', key: 'delay', options: optionPairs(Screensaver.DELAYS) }
        ];
        if (Prefs.get().wallpaper.mode === 'rotate') {
            blocks.push({ title: 'Change photo every', key: 'photoEvery', options: optionPairs(Screensaver.PHOTO_EVERY) });
        }
        blocks.push({ title: 'Go dark after', key: 'dark', options: optionPairs(Screensaver.DARK_AFTER) });
        return blocks;
    }

    function optionPairs(list) {
        return list.map(function (o) { return [o.key, o.label]; });
    }

    function renderScreensaver() {
        var p = Prefs.get().screensaver;
        var body = $('screensaver-body');
        body.innerHTML = '';
        screensaverBlocks().forEach(function (b) {
            var block = el('div', 'setting-block');
            block.appendChild(el('h2', '', t(b.title)));
            var chips = el('div', 'chips');
            b.options.forEach(function (o) {
                chips.appendChild(chip(o[1], p[b.key] === o[0], { key: b.key, value: o[0] }));
            });
            block.appendChild(chips);
            body.appendChild(block);
        });

        var tryBlock = el('div', 'setting-block');
        tryBlock.appendChild(el('h2', '', t('Try it')));
        var tryChips = el('div', 'chips');
        tryChips.appendChild(chip('Show it now', false, { kind: 'preview' }));
        tryBlock.appendChild(tryChips);
        body.appendChild(tryBlock);
    }

    function activateScreensaver(item) {
        if (item.kind === 'preview') {
            Screensaver.open();
            return;
        }
        Prefs.get().screensaver[item.key] = item.value;
        Prefs.save();
        // Otherwise a countdown that began before the change could fire straight away.
        Screensaver.poke();
        renderScreensaver();
        UI.refresh();
    }

    // ---------- Apps on Home editor (two columns, custom navigation)

    var ed = { col: 0, idx: [0, 0], moving: -1, snapshot: null, items: [], others: [] };

    function edLoad() {
        ed.items = Home.homeItems().slice();
        var onHome = {};
        ed.items.forEach(function (i) { onHome[i.id] = true; });
        ed.others = Apps.allSorted(Home.apps(), false, ed.items, Prefs.get().hiddenApps).filter(function (a) { return !onHome[a.id]; });
    }

    function edRow(item, moving) {
        var row = el('div', 'ed-item' + (moving ? ' moving' : ''));
        row.appendChild(Home.miniTile(item));
        row.appendChild(el('span', 'ed-label', item.label));
        if (moving) row.appendChild(el('span', 'ed-move', '↕'));
        return row;
    }

    function edRender() {
        var home = $('ed-home');
        home.innerHTML = '';
        ed.items.forEach(function (item, i) { home.appendChild(edRow(item, i === ed.moving)); });
        var other = $('ed-other');
        other.innerHTML = '';
        ed.others.forEach(function (item) { other.appendChild(edRow(item, false)); });
        $('ed-home-title').textContent = t('On Home') + ' · ' + ed.items.length;
        $('ed-other-title').textContent = t('Add apps') + ' · ' + ed.others.length;
        if (!ed.others.length) ed.col = 0;
    }

    function edFocusEl() {
        var list = [$('ed-home'), $('ed-other')][ed.col];
        if (!list.children.length) return null;
        ed.idx[ed.col] = UI.clamp(ed.idx[ed.col], 0, list.children.length - 1);
        return list.children[ed.idx[ed.col]];
    }

    function edSave() {
        Home.setHomeItems(ed.items);
        edLoad();
    }

    /*
     * Focus plus hints, but the hint bar is only rebuilt when its content would actually differ.
     * Arrowing through the list is the hot path on this screen and should not churn the DOM.
     */
    function edRefresh() {
        var sig = ed.col + '/' + (ed.moving >= 0);
        if (sig !== ed.hintSig) {
            ed.hintSig = sig;
            UI.refreshHints();
        }
        UI.refresh();
    }

    function edKey(k) {
        var moving = ed.moving >= 0;
        if (k === KEY.UP || k === KEY.DOWN) {
            var d = k === KEY.UP ? -1 : 1;
            if (moving) {
                var to = ed.moving + d;
                if (to < 0 || to >= ed.items.length) return true;
                var tmp = ed.items[to];
                ed.items[to] = ed.items[ed.moving];
                ed.items[ed.moving] = tmp;
                ed.moving = to;
                ed.idx[0] = to;
                edRender();
            } else {
                ed.idx[ed.col] += d;
            }
            edRefresh();
            return true;
        }
        if (k === KEY.LEFT || k === KEY.RIGHT) {
            if (!moving) {
                var col = k === KEY.LEFT ? 0 : 1;
                if ([$('ed-home'), $('ed-other')][col].children.length) ed.col = col;
                edRefresh();
            }
            return true;
        }
        if (k === KEY.ENTER) {
            if (ed.col === 0) {
                if (moving) {
                    ed.moving = -1;
                    ed.snapshot = null;
                    edSave();
                    edRender();
                } else {
                    edMenu();
                }
            } else if (ed.others.length) {
                var added = ed.others[ed.idx[1]];
                ed.items.push(added);
                edSave();
                edRender();
                UI.toast(t('Added {0} to Home', added.label));
            }
            edRefresh();
            return true;
        }
        return false;
    }

    function edMenu() {
        var i = ed.idx[0];
        var item = ed.items[i];
        if (!item) return;
        UI.menu(item.label, [
            {
                label: 'Move', run: function () {
                    ed.moving = i;
                    ed.snapshot = ed.items.slice();
                    edRender();
                    UI.refresh();
                }
            },
            {
                label: 'Remove from Home', run: function () {
                    if (ed.items.length <= 1) {
                        UI.toast('Home needs at least one app');
                        return;
                    }
                    ed.items.splice(i, 1);
                    edSave();
                    edRender();
                    UI.refresh();
                }
            },
            { label: 'Cancel' }
        ]);
    }

    function edBack() {
        if (ed.moving < 0) return false;
        ed.items = ed.snapshot;
        ed.moving = -1;
        ed.snapshot = null;
        edRender();
        UI.refresh();
        return true;
    }

    // ---------- Consoles

    var renderConsoles = null;

    function methodOf(input) {
        var key = input.method || window.LAUNCHER_CONFIG.inputMethod;
        return METHODS.find(function (m) { return m.key === key; }) || METHODS[0];
    }

    function logoOf(input) {
        return LOGOS.find(function (l) { return l.key === (input.brand || ''); }) || LOGOS[LOGOS.length - 1];
    }

    function consoleEntries() {
        var entries = Home.inputs().map(function (input, i) {
            return {
                label: input.label,
                value: input.hidden ? 'Hidden' : 'HDMI ' + input.hdmi + ' · ' + t(methodOf(input).label),
                mini: Home.miniInputTile(input),
                run: function () { consoleMenu(i); }
            };
        });
        entries.push({ label: '+ Add a console', value: '', run: addConsole });
        return entries;
    }

    function editInputs(change) {
        var list = Home.inputs().map(function (i) { return Object.assign({}, i); });
        change(list);
        Home.setInputs(list);
        renderConsoles();
        UI.refresh();
    }

    function consoleMenu(i) {
        var c = Home.inputs()[i];
        var count = Home.inputs().length;
        var status = Home.hdmiStatus();
        var options = [
            {
                label: 'Rename', run: function () {
                    rename(c.label, function (name) { editInputs(function (l) { l[i].label = name; }); });
                }
            },
            {
                label: t('HDMI port') + ' · HDMI ' + c.hdmi, run: function () {
                    UI.menu('HDMI port', [1, 2, 3, 4].map(function (n) {
                        return {
                            label: 'HDMI ' + n + (status[n] ? ' · ' + t('connected') : ''),
                            checked: n === c.hdmi,
                            run: function () { editInputs(function (l) { l[i].hdmi = n; }); }
                        };
                    }));
                }
            },
            {
                label: t('Logo') + ' · ' + t(logoOf(c).label), run: function () {
                    UI.menu('Logo', LOGOS.map(function (logo) {
                        return {
                            label: logo.label,
                            checked: logo.key === (c.brand || ''),
                            run: function () { editInputs(function (l) { l[i].brand = logo.key; }); }
                        };
                    }));
                }
            },
            {
                label: t('Opens') + ' · ' + t(methodOf(c).label), run: function () {
                    UI.menu('Opens', METHODS.map(function (m) {
                        return {
                            label: t(m.label) + ' · ' + t(m.hint),
                            checked: m.key === methodOf(c).key,
                            run: function () { editInputs(function (l) { l[i].method = m.key; }); }
                        };
                    }));
                }
            },
            {
                label: c.hidden ? 'Show on Home' : 'Hide from Home',
                run: function () { editInputs(function (l) { l[i].hidden = !c.hidden; }); }
            }
        ];
        if (i > 0) {
            options.push({ label: 'Move earlier', run: function () { editInputs(function (l) { l.splice(i - 1, 0, l.splice(i, 1)[0]); }); } });
        }
        if (i < count - 1) {
            options.push({ label: 'Move later', run: function () { editInputs(function (l) { l.splice(i + 1, 0, l.splice(i, 1)[0]); }); } });
        }
        options.push({
            label: 'Remove', run: function () {
                UI.menu(t('Remove {0}?', c.label), [
                    { label: 'Remove', run: function () { editInputs(function (l) { l.splice(i, 1); }); } },
                    { label: 'Cancel' }
                ]);
            }
        });
        options.push({ label: 'Cancel' });
        UI.menu(c.label, options);
    }

    function addConsole() {
        var used = {};
        Home.inputs().forEach(function (i) { used[i.hdmi] = true; });
        var port = [1, 2, 3, 4].find(function (n) { return !used[n]; }) || 1;
        editInputs(function (l) { l.push({ hdmi: port, label: 'Console', brand: '' }); });
        var index = Home.inputs().length - 1;
        rename('Console', function (name) { editInputs(function (l) { l[index].label = name; }); });
    }

    // ---------- Rename dialog (uses Samsung's on-screen keyboard)

    var renameDone = null;

    function rename(current, done, title) {
        renameDone = done;
        $('rename-title').textContent = t(title || 'Name');
        $('rename-input').value = current;
        UI.show('rename');
    }

    function closeRename(save) {
        var input = $('rename-input');
        var value = input.value.trim();
        var done = renameDone;
        renameDone = null;
        input.blur();
        UI.back();
        if (save && value && done) done(value);
    }

    // ---------- Advanced

    function advancedEntries() {
        var entries = [
            {
                label: 'Refresh app list', value: 'After installing or removing apps', run: function () {
                    UI.toast('Refreshing the app list…');
                    Home.reloadApps().then(function () { UI.toast('App list refreshed'); });
                }
            }
        ];
        if (window.LAUNCHER_CONFIG.devLogUrl) {
            entries.push({
                label: 'Export settings', value: 'Sends them to the Mac log', run: function () {
                    DevLog.log('Settings export', Prefs.get());
                    UI.toast('Settings sent to the Mac log');
                }
            });
        }
        entries.push({
            label: 'Reset all settings', value: 'Back to the defaults', run: function () {
                UI.menu('Reset all settings?', [
                    {
                        label: 'Reset', run: function () {
                            Prefs.reset();
                            location.reload();
                        }
                    },
                    { label: 'Cancel' }
                ]);
            }
        });
        entries.push({
            label: 'Return here after an app',
            value: t(Prefs.get().returnHere ? 'On' : 'Off') + ' · ' + t('experimental'),
            run: function () {
                Prefs.get().returnHere = !Prefs.get().returnHere;
                Prefs.save();
                renderAdvanced();
                UI.refresh();
            }
        });
        entries.push({ label: 'Lab', value: 'Developer tests', run: function () { UI.show('lab'); } });
        return entries;
    }

    // ---------- Registration

    function init() {
        renderOverview = registerList('settings', overviewEntries,
            [['OK', 'Change'], ['◀ ▶', 'Switch column'], ['Back', 'Home']], true);
        renderAdvanced = registerList('advanced', advancedEntries, [['OK', 'Run'], ['Back', 'Settings']]);
        renderConsoles = registerList('consoles', consoleEntries,
            [['OK', 'Options'], ['Back', 'Settings']]);

        UI.register('bg', {
            el: $('bg-settings'),
            rows: function () { return chipRows($('bg-body')); },
            onShow: renderBackground,
            activate: activateBackground,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('appearance', {
            el: $('appearance'),
            rows: function () { return chipRows($('appearance-body')); },
            onShow: renderAppearance,
            activate: activateAppearance,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('sound-settings', {
            el: $('sound-settings'),
            rows: function () { return chipRows($('sound-body')); },
            onShow: renderSound,
            activate: activateSound,
            hints: [['OK', 'Select / Preview'], ['Back', 'Settings']]
        });

        UI.register('screensaver-settings', {
            el: $('screensaver-settings'),
            rows: function () { return chipRows($('screensaver-body')); },
            onShow: renderScreensaver,
            activate: activateScreensaver,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('homeapps', {
            el: $('homeapps'),
            onShow: function (opts) {
                if (!opts.back) {
                    ed.col = 0;
                    ed.idx = [0, 0];
                    ed.moving = -1;
                }
                edLoad();
                edRender();
            },
            focusEl: edFocusEl,
            onKey: edKey,
            onBack: edBack,
            hints: function () {
                if (ed.moving >= 0) {
                    return [['▲ ▼', 'Reorder'], ['OK', 'Drop here'], ['Back', 'Cancel']];
                }
                return [
                    ['OK', ed.col === 0 ? 'Options' : 'Add to Home'],
                    ['◀ ▶', 'Switch column'],
                    ['Back', 'Settings']
                ];
            }
        });

        UI.register('rename', {
            el: $('rename'),
            overlay: true,
            focusEl: function () { return $('rename-input'); },
            hints: [['OK', 'Save'], ['Back', 'Cancel']],
            onShow: function () {
                setTimeout(function () {
                    var input = $('rename-input');
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }, 0);
            },
            onKey: function (k) {
                if (k === KEY.ENTER || k === IME_DONE) {
                    closeRename(true);
                    return true;
                }
                if (k === KEY.BACK || k === KEY.ESC || k === IME_CANCEL) {
                    closeRename(false);
                    return true;
                }
                return 'pass';
            }
        });

        Home.onAppsChanged(function () {
            if (UI.isVisible('homeapps') && ed.moving < 0) {
                edLoad();
                edRender();
                UI.refresh();
            }
        });
    }

    window.Settings = { init: init };
})();
