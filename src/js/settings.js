/* Settings: overview, Background, Apps on Home, Consoles, Appearance, Samsung, Advanced. */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var KEY = UI.KEY;
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
            li.appendChild(el('span', 'setting-label', e.label));
            li.appendChild(el('span', 'setting-value', e.value || ''));
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
            UI.toast('Could not open Samsung Home: ' + DevLog.errorText(err));
        }).then(function () { opening = false; });
    }

    // ---------- Overview

    function wallpaperSummary() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') return 'Off';
        if (p.mode === 'live') {
            var src = window.LiveWallpaper ? LiveWallpaper.providerLabel() : 'Bing';
            var cur = Wallpaper.find(p.liveKey);
            return 'Live · ' + src;
        }
        if (p.mode === 'rotate') return 'Rotate · ' + Wallpaper.interval(p.interval).label.toLowerCase();
        var w = Wallpaper.find(p.photo);
        return w ? w.title : 'Photo';
    }

    function overviewEntries() {
        var a = Prefs.get().appearance;
        var shown = Home.inputs().filter(function (i) { return !i.hidden; }).length;
        return [
            { label: 'Background', value: wallpaperSummary(), run: function () { UI.show('bg'); } },
            { label: 'Apps on Home', value: Home.homeItems().length + ' apps', run: function () { UI.show('homeapps'); } },
            { label: 'Consoles', value: shown + ' on Home', run: function () { UI.show('consoles'); } },
            { label: 'Appearance', value: Appearance.font(a.font).label + ' · ' + (a.clock === '12h' ? '12-hour' : '24-hour'), run: function () { UI.show('appearance'); } },
            { label: 'Navigation sound', value: soundSummary(), run: function () { UI.show('sound-settings'); } },
            { label: 'Screen saver', value: screensaverSummary(), run: function () { UI.show('screensaver-settings'); } },
            { label: 'Weather', value: Weather.summary(), run: function () { UI.show('weather-settings'); } },
            { label: 'Music', value: Music.summary(), run: function () { UI.show('music-settings'); } },
            { label: 'Samsung Home', value: 'Smart Hub and TV settings', run: openSamsungHome },
            { label: 'Advanced', value: 'Refresh, reset, Lab', run: function () { UI.show('advanced'); } }
        ];
    }

    // ---------- Chips (Background, Appearance)

    function chip(label, on, item) {
        var c = el('div', 'chip' + (on ? ' on' : ''), label);
        c._item = item;
        return c;
    }

    function iconChip(svg, on, item, label) {
        var c = el('div', 'chip icon-chip' + (on ? ' on' : ''));
        c.innerHTML = svg;
        c._item = item;
        if (label) c.setAttribute('aria-label', label);
        return c;
    }

    var ICON = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
        next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
        volLow: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11.5 3a2.5 2.5 0 0 0-1.5-2.3v4.6a2.5 2.5 0 0 0 1.5-2.3z"/></svg>',
        volMed: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/><path d="M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" opacity=".45"/></svg>',
        volHigh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/><path d="M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>'
    };

    function chipRows(container) {
        var rows = [];
        UI.children(container).forEach(function (block) {
            if (block.classList.contains('hidden')) return;
            var chips = block.querySelector('.chips, .thumbs');
            if (!chips) return;
            if (chips.classList.contains('thumbs')) rows = rows.concat(UI.chunk(UI.children(chips), THUMB_COLS));
            else {
                // Skip spacer nodes (e.g. Controls | Volume gap) so focus stays on real chips.
                rows.push(UI.children(chips).filter(function (n) {
                    return !n.classList.contains('chip-gap');
                }));
            }
        });
        return rows;
    }

    // ---------- Background

    function renderBackground() {
        var p = Prefs.get().wallpaper;
        var live = p.mode === 'live';
        var cycle = p.mode === 'rotate' || live;

        var modes = $('bg-mode');
        modes.innerHTML = '';
        [['off', 'Off'], ['photo', 'Photo'], ['rotate', 'Rotate'], ['live', 'Live']].forEach(function (m) {
            modes.appendChild(chip(m[1], p.mode === m[0], { kind: 'mode', key: m[0] }));
        });

        var intervals = $('bg-interval');
        intervals.innerHTML = '';
        Wallpaper.INTERVALS.forEach(function (i) {
            intervals.appendChild(chip(i.label, p.interval === i.key, { kind: 'interval', key: i.key }));
        });
        $('bg-interval-block').classList.toggle('hidden', !cycle);

        var prov = p.liveProvider || 'bing';
        var liveProvBlock = $('bg-live-provider-block');
        if (liveProvBlock) {
            liveProvBlock.classList.toggle('hidden', !live);
            var providers = $('bg-live-provider');
            providers.innerHTML = '';
            (window.LiveWallpaper ? LiveWallpaper.PROVIDERS : [{ key: 'bing', label: 'Bing' }])
                .forEach(function (x) {
                    providers.appendChild(chip(x.label, prov === x.key, { kind: 'provider', key: x.key }));
                });
        }

        var showUnsplash = live && (prov === 'unsplash' || prov === 'mix');
        var unsplashBlock = $('bg-live-unsplash-block');
        if (unsplashBlock) {
            unsplashBlock.classList.toggle('hidden', !showUnsplash);
            var keyChips = $('bg-live-unsplash-key');
            keyChips.innerHTML = '';
            keyChips.appendChild(chip(
                window.LiveWallpaper ? LiveWallpaper.unsplashKeySummary() : 'Set Access Key',
                window.LiveWallpaper && LiveWallpaper.unsplashConfigured(),
                { kind: 'unsplashKey' }
            ));
            keyChips.appendChild(chip(
                window.LiveWallpaper ? LiveWallpaper.unsplashCollectionSummary() : 'Popular photos',
                !!(window.LiveWallpaper && LiveWallpaper.unsplashCollection()),
                { kind: 'unsplashCollection' }
            ));
        }

        var showImmich = live && (prov === 'immich' || prov === 'mix');
        var immichBlock = $('bg-live-immich-block');
        if (immichBlock) {
            immichBlock.classList.toggle('hidden', !showImmich);
            var immichChips = $('bg-live-immich');
            immichChips.innerHTML = '';
            immichChips.appendChild(chip(
                window.LiveWallpaper ? LiveWallpaper.immichSummary() : 'Set share link',
                !!(window.LiveWallpaper && LiveWallpaper.immichConfigured()),
                { kind: 'immichLink' }
            ));
        }

        var shuffleBlock = $('bg-shuffle-block');
        if (shuffleBlock) {
            shuffleBlock.classList.toggle('hidden', !cycle);
            var shuffleChips = $('bg-shuffle');
            shuffleChips.innerHTML = '';
            [[false, 'Off'], [true, 'On']].forEach(function (o) {
                shuffleChips.appendChild(chip(o[1], !!p.random === o[0], { kind: 'random', value: o[0] }));
            });
        }

        var liveStatus = $('bg-live-status-block');
        if (liveStatus) {
            liveStatus.classList.toggle('hidden', !live || !!(window.LiveWallpaper && LiveWallpaper.needsSetup()));
            var pool = live ? Wallpaper.list() : [];
            var cur = live ? Wallpaper.find(p.liveKey) : null;
            var src = window.LiveWallpaper ? LiveWallpaper.providerLabel() : 'Bing';
            var fetching = (window.LiveWallpaper && LiveWallpaper.status()) || 'Fetching ' + src + '…';
            $('bg-live-status').textContent = cur ? '' : fetching;
            var planned = window.LiveWallpaper && LiveWallpaper.planCount ? LiveWallpaper.planCount() : 0;
            var cap = (planned ? planned + ' planned · ' : '') +
                (pool.length ? pool.length + ' recent · ' : '') + src;
            if (prov === 'mix' && window.LiveWallpaper && LiveWallpaper.mixSources) {
                var parts = LiveWallpaper.mixSources();
                if (parts.length) cap += ' · ' + parts.join('+') + (p.random ? ' (shuffled)' : '');
            }
            $('bg-live-cap').textContent = cap;
        }

        var photos = $('bg-photos');
        photos.innerHTML = '';
        Wallpaper.bundled().forEach(function (w) {
            var t = el('div', 'thumb' + (p.photo === w.key ? ' on' : ''));
            var img = new Image();
            img.src = w.thumb;
            t.appendChild(img);
            t.appendChild(el('div', 'thumb-title', w.title));
            t._item = { kind: 'photo', key: w.key };
            photos.appendChild(t);
        });
        $('bg-photos-block').classList.toggle('hidden', p.mode !== 'photo');
    }

    function activateBackground(item) {
        var p = Prefs.get().wallpaper;
        if (item.kind === 'immichLink') {
            rename('', function (link) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setImmichLink(link);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                renderBackground();
                UI.refresh();
            }, { title: 'Immich shared album link', maxLength: 200, allowEmpty: true });
            return;
        }
        if (item.kind === 'unsplashKey') {
            rename('', function (key) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setUnsplashKey(key);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                renderBackground();
                UI.refresh();
            }, { title: 'Unsplash Access Key', maxLength: 64, password: true });
            return;
        }
        if (item.kind === 'unsplashCollection') {
            rename(window.LiveWallpaper ? LiveWallpaper.unsplashCollection() : '', function (id) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setUnsplashCollection(id);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                renderBackground();
                UI.refresh();
            }, { title: 'Unsplash collection ID', maxLength: 64, allowEmpty: true });
            return;
        }
        if (item.kind === 'mode') {
            p.mode = item.key;
            if (item.key === 'rotate' || item.key === 'live') p.lastChange = Date.now();
        } else if (item.kind === 'interval') {
            p.interval = item.key;
            p.lastChange = Date.now();
        } else if (item.kind === 'random') {
            p.random = !!item.value;
            // Rebuild upcoming Mix slots so Shuffle changes provider order; keep the current photo.
            if (p.mode === 'live' && window.LiveWallpaper && LiveWallpaper.rebuildPlan) {
                LiveWallpaper.rebuildPlan();
            }
        } else if (item.kind === 'provider') {
            if (p.liveProvider === item.key) return;
            p.liveProvider = item.key;
            p.liveKey = '';
            p.lastChange = Date.now();
            if (window.LiveWallpaper) LiveWallpaper.clearCache();
            if (window.LiveWallpaper && LiveWallpaper.needsSetup()) UI.toast(LiveWallpaper.status());
        } else if (item.kind === 'photo') {
            p.photo = item.key;
        }
        Prefs.save();
        Wallpaper.apply();
        if (p.mode === 'live') Wallpaper.ensureLive();
        renderBackground();
        UI.refresh();
    }

    // ---------- Appearance

    function appearanceBlocks() {
        return [
            { title: 'Clock', key: 'clock', options: [['24h', '24-hour'], ['12h', '12-hour']] },
            { title: 'Date', key: 'showDate', options: [[true, 'Show'], [false, 'Hide']] },
            { title: 'Date language', key: 'locale', options: Appearance.LOCALES.map(function (l) { return [l.key, l.label]; }) },
            { title: 'Font', key: 'font', options: Appearance.FONTS.map(function (f) { return [f.key, f.label, f.family]; }) },
            { title: 'App names', key: 'names', options: [['always', 'Always'], ['focused', 'When selected'], ['never', 'Never']] }
        ];
    }

    function renderAppearance() {
        var p = Prefs.get().appearance;
        var body = $('appearance-body');
        body.innerHTML = '';
        appearanceBlocks().forEach(function (b) {
            var block = el('div', 'setting-block');
            block.appendChild(el('h2', '', b.title));
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
        renderAppearance();
        UI.refresh();
    }

    // ---------- Navigation sound

    function soundSummary() {
        var p = Prefs.get().sound;
        return p.enabled ? 'On · ' + Sound.presetLabel() : 'Off';
    }

    function renderSound() {
        var p = Prefs.get().sound;
        var body = $('sound-body');
        body.innerHTML = '';

        var enabledBlock = el('div', 'setting-block');
        enabledBlock.appendChild(el('h2', '', 'Sound'));
        var enabledChips = el('div', 'chips');
        enabledChips.appendChild(chip('On', p.enabled, { kind: 'enabled', value: true }));
        enabledChips.appendChild(chip('Off', !p.enabled, { kind: 'enabled', value: false }));
        enabledBlock.appendChild(enabledChips);
        body.appendChild(enabledBlock);

        var presetBlock = el('div', 'setting-block');
        presetBlock.appendChild(el('h2', '', 'Style'));
        var presetChips = el('div', 'chips');
        Sound.presetOptions().forEach(function (preset) {
            presetChips.appendChild(chip(preset.label, p.preset === preset.key,
                { kind: 'preset', value: preset.key }));
        });
        presetBlock.appendChild(presetChips);
        body.appendChild(presetBlock);

        var previewBlock = el('div', 'setting-block');
        previewBlock.appendChild(el('h2', '', 'Try it'));
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

    // ---------- Music (Subsonic ambient)

    function maskSecret(value) {
        if (!value) return 'Set password';
        return 'Password set';
    }

    function renderMusic() {
        var p = Prefs.get().music;
        var c = Subsonic.cfg();
        var body = $('music-body');
        body.innerHTML = '';

        var status = el('p', 'setting-note', Music.statusText());
        body.appendChild(status);

        var onBlock = el('div', 'setting-block');
        onBlock.appendChild(el('h2', '', 'Music'));
        var onChips = el('div', 'chips');
        onChips.appendChild(chip('On', p.enabled, { kind: 'enabled', value: true }));
        onChips.appendChild(chip('Off', !p.enabled, { kind: 'enabled', value: false }));
        onBlock.appendChild(onChips);
        body.appendChild(onBlock);

        var serverBlock = el('div', 'setting-block');
        serverBlock.appendChild(el('h2', '', 'Server'));
        var serverChips = el('div', 'chips wrap');
        serverChips.appendChild(chip(c.baseUrl || 'Set server URL', !!c.baseUrl, { kind: 'server' }));
        serverChips.appendChild(chip(c.user || 'Set username', !!c.user, { kind: 'user' }));
        serverChips.appendChild(chip(maskSecret(c.password), !!c.password, { kind: 'password' }));
        serverChips.appendChild(chip('Test connection', false, { kind: 'test' }));
        serverBlock.appendChild(serverChips);
        body.appendChild(serverBlock);
        body.appendChild(el('p', 'setting-note muted', Subsonic.summary()));

        var srcBlock = el('div', 'setting-block');
        srcBlock.appendChild(el('h2', '', 'Source'));
        var srcChips = el('div', 'chips wrap');
        var onPlaylist = p.source === 'playlist' && !!p.playlistId;
        srcChips.appendChild(chip('Random', !onPlaylist, { kind: 'source', value: 'random' }));
        srcChips.appendChild(chip(
            onPlaylist ? (p.playlistName || 'Playlist') : 'Playlist…',
            onPlaylist,
            { kind: 'source', value: 'playlist' }
        ));
        srcBlock.appendChild(srcChips);
        body.appendChild(srcBlock);

        var playBlock = el('div', 'setting-block');
        var heads = el('div', 'setting-inline-heads');
        heads.appendChild(el('h2', '', 'Controls'));
        heads.appendChild(el('h2', '', 'Volume'));
        playBlock.appendChild(heads);
        var playChips = el('div', 'chips');
        var playing = Music.isPlaying();
        playChips.appendChild(iconChip(ICON.play, playing, { kind: 'play' }, 'Play'));
        playChips.appendChild(iconChip(ICON.pause, !playing && !!Music.current(), { kind: 'pause' }, 'Pause'));
        playChips.appendChild(iconChip(ICON.next, false, { kind: 'next' }, 'Next'));
        playChips.appendChild(el('div', 'chip-gap'));
        playChips.appendChild(iconChip(ICON.volLow, p.volume === 'low', { kind: 'volume', value: 'low' }, 'Low'));
        playChips.appendChild(iconChip(ICON.volMed, p.volume === 'med', { kind: 'volume', value: 'med' }, 'Med'));
        playChips.appendChild(iconChip(ICON.volHigh, p.volume === 'high', { kind: 'volume', value: 'high' }, 'High'));
        playBlock.appendChild(playChips);
        body.appendChild(playBlock);

        body.appendChild(el('p', 'setting-note muted',
            'Plays while this launcher is open. Pauses when you open another app. Saved on the TV — no rebuild needed.'));
    }

    function pickMusicPlaylist() {
        if (!Subsonic.configured()) {
            UI.toast('Set server, user and password first');
            return;
        }
        UI.toast('Loading playlists…');
        Subsonic.getPlaylists().then(function (list) {
            if (!list.length) {
                UI.toast('No playlists on this server');
                return;
            }
            var p = Prefs.get().music;
            var options = list.map(function (pl) {
                var label = pl.name;
                if (pl.songCount != null) label += ' · ' + pl.songCount;
                return {
                    label: label,
                    checked: p.source === 'playlist' && String(p.playlistId) === String(pl.id),
                    run: function () {
                        Music.setSource('playlist', pl);
                        renderMusic();
                        UI.refresh();
                        UI.toast('Music: ' + Music.sourceLabel());
                    }
                };
            });
            options.push({ label: 'Cancel' });
            UI.menu('Playlists', options);
        }).catch(function (e) {
            UI.toast('Playlists failed: ' + ((e && e.message) || 'error'));
        });
    }

    function activateMusic(item) {
        var c = Subsonic.cfg();
        if (item.kind === 'server') {
            rename(c.baseUrl || 'http://', function (url) {
                Subsonic.setCreds({ baseUrl: url });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                renderMusic();
                UI.refresh();
            }, { title: 'Server URL', maxLength: 120 });
            return;
        }
        if (item.kind === 'user') {
            rename(c.user || '', function (user) {
                Subsonic.setCreds({ user: user });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                renderMusic();
                UI.refresh();
            }, { title: 'Username', maxLength: 64 });
            return;
        }
        if (item.kind === 'password') {
            rename('', function (password) {
                Subsonic.setCreds({ password: password });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                renderMusic();
                UI.refresh();
            }, { title: 'Password', maxLength: 64, password: true });
            return;
        }
        if (item.kind === 'test') {
            if (!Subsonic.configured()) {
                UI.toast('Set server, user and password first');
                return;
            }
            UI.toast('Testing…');
            Subsonic.ping().then(function () {
                UI.toast('Connected');
                renderMusic();
                UI.refresh();
            }).catch(function (e) {
                UI.toast('Failed: ' + ((e && e.message) || 'error'));
                renderMusic();
                UI.refresh();
            });
            return;
        }
        if (item.kind === 'source') {
            if (item.value === 'playlist') {
                pickMusicPlaylist();
                return;
            }
            Music.setSource('random');
            UI.toast('Music: Random');
        } else if (item.kind === 'enabled') {
            Music.setEnabled(item.value);
            if (!item.value) Music.pause();
        } else if (item.kind === 'volume') {
            Music.setVolume(item.value);
        } else if (item.kind === 'play') {
            Music.play();
        } else if (item.kind === 'pause') {
            Music.pause();
        } else if (item.kind === 'next') {
            Music.next();
        }
        renderMusic();
        UI.refresh();
    }

    // ---------- Weather

    var weatherBusy = false;

    function applyWeatherPlace(resolved) {
        var p = Prefs.get().weather;
        p.place = resolved.place;
        p.latitude = resolved.latitude;
        p.longitude = resolved.longitude;
        p.label = resolved.label;
        Prefs.save();
        Weather.applySettings();
        renderWeather();
        UI.refresh();
    }

    function renderWeather() {
        var p = Prefs.get().weather;
        var body = $('weather-body');
        body.innerHTML = '';

        var placeBlock = el('div', 'setting-block');
        placeBlock.appendChild(el('h2', '', 'Place'));
        var placeChips = el('div', 'chips wrap');
        Weather.PLACES.forEach(function (place) {
            placeChips.appendChild(chip(place.label, p.place === place.key,
                { kind: 'place', value: place.key }));
        });
        if (p.place === 'custom') {
            placeChips.appendChild(chip(p.label || 'Custom', true, { kind: 'place', value: 'custom' }));
        }
        placeBlock.appendChild(placeChips);
        body.appendChild(placeBlock);

        var findBlock = el('div', 'setting-block');
        findBlock.appendChild(el('h2', '', 'Find'));
        var findChips = el('div', 'chips wrap');
        findChips.appendChild(chip('Use my location', false, { kind: 'detect' }));
        findChips.appendChild(chip('Search city…', false, { kind: 'search' }));
        findBlock.appendChild(findChips);
        body.appendChild(findBlock);

        var unitBlock = el('div', 'setting-block');
        unitBlock.appendChild(el('h2', '', 'Unit'));
        var unitChips = el('div', 'chips');
        unitChips.appendChild(chip('Celsius', p.unit === 'celsius', { kind: 'unit', value: 'celsius' }));
        unitChips.appendChild(chip('Fahrenheit', p.unit === 'fahrenheit', { kind: 'unit', value: 'fahrenheit' }));
        unitBlock.appendChild(unitChips);
        body.appendChild(unitBlock);

        var note = el('p', 'setting-note muted',
            'Shown on Home and the screen saver. Open-Meteo; location uses approximate IP when asked.');
        body.appendChild(note);
    }

    function activateWeather(item) {
        var p = Prefs.get().weather;
        if (item.kind === 'detect') {
            if (weatherBusy) return;
            weatherBusy = true;
            UI.toast('Finding location…');
            Weather.detectLocation(function (err, loc) {
                weatherBusy = false;
                if (err || !loc) {
                    UI.toast('Could not find location');
                    DevLog.log('Weather detect failed: ' + (err || 'unknown'));
                    return;
                }
                applyWeatherPlace(Weather.resolvePlace(loc.latitude, loc.longitude, loc.label));
                UI.toast('Weather: ' + Weather.summary());
            });
            return;
        }
        if (item.kind === 'search') {
            rename('', function (query) {
                if (weatherBusy) return;
                weatherBusy = true;
                UI.toast('Searching…');
                Weather.searchPlaces(query, function (err, results) {
                    weatherBusy = false;
                    if (err) {
                        UI.toast('Search failed');
                        DevLog.log('Weather search failed: ' + err);
                        return;
                    }
                    if (!results || !results.length) {
                        UI.toast('No cities found');
                        return;
                    }
                    UI.menu('Cities', results.map(function (r) {
                        return {
                            label: r.label,
                            run: function () {
                                applyWeatherPlace(
                                    Weather.resolvePlace(r.latitude, r.longitude, r.label)
                                );
                                UI.toast('Weather: ' + Weather.summary());
                            }
                        };
                    }).concat([{ label: 'Cancel' }]));
                });
            }, { title: 'City name', maxLength: 64 });
            return;
        }
        if (item.kind === 'place') {
            if (item.value === 'custom') return;
            p.place = item.value;
            p.latitude = null;
            p.longitude = null;
            p.label = null;
        } else if (item.kind === 'unit') {
            p.unit = item.value;
        } else {
            return;
        }
        Prefs.save();
        Weather.applySettings();
        renderWeather();
        UI.refresh();
    }

    // ---------- Screen saver

    function screensaverSummary() {
        var p = Prefs.get().screensaver;
        return p.enabled ? 'After ' + Screensaver.delay().label : 'Off';
    }

    /*
     * "Change photo" only means something while the Background is on Rotate or Live: with a
     * single photo the screen saver holds it, exactly as Home does.
     */
    function screensaverBlocks() {
        var mode = Prefs.get().wallpaper.mode;
        var blocks = [
            { title: 'Screen saver', key: 'enabled', options: [[true, 'On'], [false, 'Off']] },
            { title: 'Start after', key: 'delay', options: optionPairs(Screensaver.DELAYS) }
        ];
        if (mode === 'rotate' || mode === 'live') {
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
            block.appendChild(el('h2', '', b.title));
            var chips = el('div', 'chips');
            b.options.forEach(function (o) {
                chips.appendChild(chip(o[1], p[b.key] === o[0], { key: b.key, value: o[0] }));
            });
            block.appendChild(chips);
            body.appendChild(block);
        });

        var tryBlock = el('div', 'setting-block');
        tryBlock.appendChild(el('h2', '', 'Try it'));
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
        ed.others = Apps.allSorted(Home.apps(), false).filter(function (a) { return !onHome[a.id]; });
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
        $('ed-home-title').textContent = 'On Home · ' + ed.items.length;
        $('ed-other-title').textContent = 'Add apps · ' + ed.others.length;
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
                UI.toast('Added ' + added.label + ' to Home');
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
        return LOGOS.find(function (l) { return l.key === (input.brand || ''); }) || LOGOS[3];
    }

    function consoleEntries() {
        var entries = Home.inputs().map(function (input, i) {
            return {
                label: input.label,
                value: input.hidden ? 'Hidden' : 'HDMI ' + input.hdmi + ' · ' + methodOf(input).label,
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
                label: 'HDMI port · HDMI ' + c.hdmi, run: function () {
                    UI.menu('HDMI port', [1, 2, 3, 4].map(function (n) {
                        return {
                            label: 'HDMI ' + n + (status[n] ? ' · connected' : ''),
                            checked: n === c.hdmi,
                            run: function () { editInputs(function (l) { l[i].hdmi = n; }); }
                        };
                    }));
                }
            },
            {
                label: 'Logo · ' + logoOf(c).label, run: function () {
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
                label: 'Opens · ' + methodOf(c).label, run: function () {
                    UI.menu('Opens', METHODS.map(function (m) {
                        return {
                            label: m.label + ' · ' + m.hint,
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
                UI.menu('Remove ' + c.label + '?', [
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
    var renameAllowEmpty = false;

    function rename(current, done, opts) {
        opts = opts || {};
        renameDone = done;
        renameAllowEmpty = !!opts.allowEmpty;
        var title = $('rename-title');
        if (title) title.textContent = opts.title || 'Name';
        var input = $('rename-input');
        input.value = current || '';
        input.maxLength = opts.maxLength || 28;
        // Keep type=text: Samsung's IME often returns an empty value for type=password.
        // Mask with CSS instead (Unsplash key + Music password).
        input.type = 'text';
        input.classList.toggle('secret', !!opts.password);
        input.setAttribute('autocomplete', opts.password ? 'off' : 'off');
        UI.show('rename');
    }

    function closeRename(save) {
        var input = $('rename-input');
        var value = input.value.trim();
        var done = renameDone;
        renameDone = null;
        var allowEmpty = renameAllowEmpty;
        renameAllowEmpty = false;
        input.blur();
        input.type = 'text';
        input.classList.remove('secret');
        input.maxLength = 28;
        var title = $('rename-title');
        if (title) title.textContent = 'Name';
        UI.back();
        if (save && (value || allowEmpty) && done) done(value);
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
        entries.push({ label: 'Lab', value: 'Developer tests', run: function () { UI.show('lab'); } });
        return entries;
    }

    // ---------- Registration

    function init() {
        registerList('settings', overviewEntries,
            [['OK', 'Change'], ['◀ ▶', 'Switch column'], ['Back', 'Home']], true);
        registerList('advanced', advancedEntries, [['OK', 'Run'], ['Back', 'Settings']]);
        renderConsoles = registerList('consoles', consoleEntries,
            [['OK', 'Options'], ['Back', 'Settings']]);

        if (window.LiveWallpaper) {
            LiveWallpaper.onChange(function () {
                if (UI.current() === 'bg') renderBackground();
            });
        }
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

        UI.register('weather-settings', {
            el: $('weather-settings'),
            rows: function () { return chipRows($('weather-body')); },
            onShow: renderWeather,
            activate: activateWeather,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('music-settings', {
            el: $('music-settings'),
            rows: function () { return chipRows($('music-body')); },
            onShow: renderMusic,
            activate: activateMusic,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        if (window.Music) {
            Music.onUpdate(function () {
                if (UI.isVisible && UI.isVisible('music-settings')) {
                    renderMusic();
                    UI.refresh();
                }
            });
        }

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
