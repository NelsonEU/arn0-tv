/* Optional LAN JPEG wall. Only opaque IDs and a local relay address enter the WGT. */
(function () {
    'use strict';
    var cfg = window.LAUNCHER_CONFIG;
    var $ = UI.$;
    var active = false;
    var selected = null;
    var wall = false;

    function names() {
        if (!Array.isArray(cfg.cameras)) return [];
        return cfg.cameras.filter(function (name) {
            return typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(name);
        });
    }

    function snapshotUrl(base, name, timestamp) {
        var match = /^http:\/\/((?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}):([1-9]\d{0,4})$/.exec(base || '');
        if (!match || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid camera endpoint');
        var ip = match[1].split('.').map(Number);
        var port = Number(match[2]);
        if (ip.some(function (octet) { return octet > 255; }) || port < 1 || port > 65535 ||
            !(ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
              (ip[0] === 192 && ip[1] === 168))) throw new Error('Relay must be on a private LAN');
        if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Invalid snapshot time');
        return base + '/snapshot/' + encodeURIComponent(name) + '.jpg?t=' + timestamp;
    }

    function isConfigured() {
        var entries = names();
        if (!entries.length) return false;
        try { snapshotUrl(cfg.cameraServer, entries[0], 0); return true; }
        catch (error) { return false; }
    }

    function stopImage(img) {
        if (img._timer) clearTimeout(img._timer);
        img._timer = null;
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
    }

    function stop() {
        active = false;
        UI.children($('camera-grid')).forEach(function (card) { stopImage(card.querySelector('img')); });
        stopImage($('camera-feed'));
    }

    function schedule(img, name, delay) {
        if (img._timer) clearTimeout(img._timer);
        img._timer = setTimeout(function () {
            img._timer = null;
            if (!active) return;
            if (document.hidden) { schedule(img, name, 3000); return; }
            img.src = snapshotUrl(cfg.cameraServer, name, Date.now());
        }, delay);
    }

    function startImage(img, name, initialDelay) {
        img.onload = function () {
            if (img === $('camera-feed')) $('camera-status').textContent = 'Snapshot updated';
            schedule(img, name, 12000);
        };
        img.onerror = function () {
            if (img === $('camera-feed')) $('camera-status').textContent = 'No image; check the local relay.';
            schedule(img, name, 12000);
        };
        schedule(img, name, initialDelay);
    }

    function render() {
        stop();
        active = true;
        selected = null;
        $('camera-detail').classList.add('hidden');
        $('camera-grid').classList.remove('hidden');
        $('cameras').classList.toggle('wall-mode', wall);
        var entries = names();
        $('camera-grid').classList.toggle('many', entries.length > 6);
        var grid = $('camera-grid');
        grid.innerHTML = '';
        entries.forEach(function (name, index) {
            var card = UI.el('div', 'camera-card');
            var image = UI.el('img');
            image.alt = 'Snapshot from ' + name;
            card.appendChild(image);
            card.appendChild(UI.el('div', 'camera-label', name));
            card._item = { name: name };
            card.addEventListener('click', function () { openDetail(name); });
            grid.appendChild(card);
            // Start decoders one at a time; schedule the next image only after load/error.
            startImage(image, name, index * 1500);
        });
    }

    function openDetail(name) {
        if (names().indexOf(name) < 0) return;
        stop();
        active = true;
        selected = name;
        $('camera-grid').classList.add('hidden');
        $('camera-detail').classList.remove('hidden');
        $('camera-title').textContent = name;
        $('camera-status').textContent = 'Loading snapshot…';
        startImage($('camera-feed'), name, 0);
        UI.refresh();
    }

    function openWall() { wall = true; UI.show('cameras'); }
    function openGallery() { wall = false; UI.show('cameras'); }

    function init() {
        UI.register('cameras', {
            el: $('cameras'),
            onShow: render,
            rows: function () { return selected ? [] : UI.chunk(UI.children($('camera-grid')), names().length > 6 ? 4 : 3); },
            activate: function (item) { openDetail(item.name); },
            onBack: function () {
                if (selected) { UI.show('cameras', { back: true }); return true; }
                stop();
                return false;
            },
            hints: function () { return selected ? [['Back', 'Wall']] : [['OK', 'Expand'], ['Back', 'Home']]; }
        });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stop();
            else if (UI.isVisible('cameras') && !active) UI.show('cameras', { back: true });
        });
    }

    window.CameraView = {
        init: init, isConfigured: isConfigured, snapshotUrl: snapshotUrl,
        openWall: openWall, openGallery: openGallery
    };
})();
