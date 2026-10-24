/*
 * UI core: screens ("views"), remote focus, keys, toast, pop-up menu.
 *
 * A view is registered with UI.register(name, def):
 *   el          its root element
 *   rows()      focusable elements as rows: [[a, b, c], [d, e]] (generic arrow navigation)
 *   onShow(opts) called when the view appears (render here); opts.back when returning to it
 *   activate(item, el)   OK on an element whose `_item` is set
 *   onKey(code) handle a key first; return true if handled (for custom navigation),
 *               or 'pass' to leave it to the browser (e.g. typing in a text field)
 *   onBack()    return true if Back was handled inside the view
 *   onFocus(el) called after focus moves
 *   overlay     shown on top of the previous view instead of replacing it
 *   hints       remote keys to show along the bottom: [['OK', 'Open'], ['Back', 'Home']].
 *               A function instead of an array is called on every show, for hints that depend
 *               on state. Omit for no bar.
 */
(function () {
    'use strict';

    var KEY = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009,
        RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
        // Desktop preview equivalents: Esc/Backspace = Back, R/G/Y/B = colour keys
        ESC: 27, BACKSPACE: 8, R: 82, G: 71, Y: 89, B: 66
    };

    var views = {};
    var focus = {};
    var current = null;

    function $(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function children(parent) { return Array.prototype.slice.call(parent.children); }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function chunk(items, n) {
        var rows = [];
        for (var i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
        return rows;
    }

    function register(name, def) {
        views[name] = def;
        focus[name] = { r: def.startRow || 0, c: 0, last: {} };
    }

    /*
     * The hint bar sits outside the views so it survives view switches. An overlay keeps its own
     * hints if it declares them and otherwise leaves the bar beneath it alone, so a pop-up over
     * Home does not blank Home's shortcuts.
     */
    function renderHints(def) {
        var bar = $('hints');
        if (!bar) return;
        var list = typeof def.hints === 'function' ? def.hints() : def.hints;
        if (!list && def.overlay) return;
        bar.innerHTML = '';
        if (!list || !list.length) {
            bar.classList.add('hidden');
            return;
        }
        list.forEach(function (h) {
            var group = el('div', 'hint');
            group.appendChild(el('span', 'hint-key', I18n.t(h[0])));
            group.appendChild(el('span', 'hint-label', I18n.t(h[1])));
            bar.appendChild(group);
        });
        bar.classList.remove('hidden');
    }

    // opts.back: returning to this view (do not remember where we came from)
    function show(name, opts) {
        opts = opts || {};
        var def = views[name];
        if (!opts.back && !def.overlay && current && current !== name) def.from = current;
        if (def.overlay) def.from = current;
        current = name;
        Object.keys(views).forEach(function (n) {
            var v = views[n];
            if (!v.el) return;
            var visible = n === name || (def.overlay && n === def.from);
            v.el.classList.toggle('hidden', !visible);
        });
        if (def.onShow) def.onShow(opts);
        // After onShow, so hints that read state see the state this view just rendered.
        renderHints(def);
        refresh();
    }

    function back() {
        var def = views[current];
        if (def.onBack && def.onBack()) return;
        if (def.from) show(def.from, { back: true });
    }

    function rows() {
        var def = views[current];
        return def.rows ? def.rows().filter(function (r) { return r.length; }) : [];
    }

    function focusedEl() {
        var r = rows();
        if (!r.length) return null;
        var f = focus[current];
        f.r = clamp(f.r, 0, r.length - 1);
        f.c = clamp(f.c, 0, r[f.r].length - 1);
        return r[f.r][f.c];
    }

    function setFocus(target) {
        var prev = document.querySelectorAll('.focused');
        for (var i = 0; i < prev.length; i++) prev[i].classList.remove('focused');
        if (!target) return;
        target.classList.add('focused');
        ensureVisible(target);
        var def = views[current];
        if (def.onFocus) def.onFocus(target);
    }

    function refresh() {
        var def = views[current];
        setFocus(def.focusEl ? def.focusEl() : focusedEl());
    }

    // Point generic focus at an element (e.g. after re-rendering).
    function focusOn(target) {
        var r = rows();
        for (var i = 0; i < r.length; i++) {
            var c = r[i].indexOf(target);
            if (c >= 0) {
                focus[current].r = i;
                focus[current].c = c;
            }
        }
        refresh();
    }

    function centerX(e) {
        var b = e.getBoundingClientRect();
        return b.left + b.width / 2;
    }

    function move(dr, dc) {
        var r = rows();
        if (!r.length) return;
        var f = focus[current];
        focusedEl();
        // Remembered so the sound can tell a real move from a clamp at the edge of a row.
        var wasR = f.r;
        var wasC = f.c;
        if (dc) f.c = clamp(f.c + dc, 0, r[f.r].length - 1);
        if (dr) {
            var nr = clamp(f.r + dr, 0, r.length - 1);
            if (nr !== f.r) {
                f.last[f.r] = f.c;
                var best = 0;
                // Leaving a single-item row (e.g. the gear) returns to where we were in the target row.
                if (r[f.r].length === 1 && f.last[nr] !== undefined) {
                    best = clamp(f.last[nr], 0, r[nr].length - 1);
                } else {
                    var x = centerX(r[f.r][f.c]);
                    r[nr].forEach(function (e, i) {
                        if (Math.abs(centerX(e) - x) < Math.abs(centerX(r[nr][best]) - x)) best = i;
                    });
                }
                f.r = nr;
                f.c = best;
            }
        }
        if (window.Sound) Sound.play(f.r === wasR && f.c === wasC ? 'edge' : 'move');
        refresh();
    }

    // Scrolls the focused element's track with a transform (no layout scrolling).
    // Horizontal for .row-track, vertical for .grid and .vtrack.
    function ensureVisible(item) {
        var track = item.parentNode;
        var horizontal = track.classList.contains('row-track');
        var vertical = track.classList.contains('grid') || track.classList.contains('vtrack');
        if (!horizontal && !vertical) return;
        var port = track.parentNode;
        var size = horizontal ? port.clientWidth
            : port.clientHeight - (parseInt(getComputedStyle(port).paddingTop, 10) || 0);
        var start = horizontal ? item.offsetLeft : item.offsetTop;
        var len = horizontal ? item.offsetWidth : item.offsetHeight;
        var pos = track._pos || 0;
        if (start < pos) pos = start;
        else if (start + len > pos + size) pos = start + len - size;
        if (pos === track._pos) return;
        track._pos = pos;
        track.style.transform = horizontal ? 'translateX(' + (-pos) + 'px)' : 'translateY(' + (-pos) + 'px)';
    }

    function resetScroll(track) {
        track._pos = 0;
        track.style.transform = '';
    }

    var keyHook = null;   // e.g. HDMI shown inside the launcher swallows keys
    var colourKey = null; // global shortcuts

    // The hint bar fades out once the remote has been idle for a while and returns on any key.
    var hintTimer = null;
    function wakeHints() {
        var bar = $('hints');
        if (!bar) return;
        bar.classList.remove('idle');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(function () { bar.classList.add('idle'); }, 6000);
    }

    function onKey(e) {
        var k = e.keyCode;
        wakeHints();
        if (keyHook && keyHook(k)) {
            e.preventDefault();
            return;
        }
        var def = views[current];
        var handled = def.onKey ? def.onKey(k) : false;
        if (handled === 'pass') return;
        if (handled) {
            e.preventDefault();
            return;
        }
        switch (k) {
            case KEY.UP: move(-1, 0); break;
            case KEY.DOWN: move(1, 0); break;
            case KEY.LEFT: move(0, -1); break;
            case KEY.RIGHT: move(0, 1); break;
            case KEY.ENTER:
                var cur = def.focusEl ? def.focusEl() : focusedEl();
                if (cur && cur._item && def.activate) def.activate(cur._item, cur);
                break;
            case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: back(); break;
            default:
                if (!(colourKey && colourKey(k, current))) return;
        }
        e.preventDefault();
    }

    var toastTimer = null;
    function toast(msg) {
        $('toast').textContent = I18n.t(msg);
        $('toast').classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { $('toast').classList.remove('visible'); }, 3500);
    }

    // Small pop-up list over the current view. options: [{ label, run, checked }]
    function menu(title, options) {
        $('menu-title').textContent = I18n.t(title);
        var list = $('menu-list');
        list.innerHTML = '';
        options.forEach(function (o) {
            var li = el('li', o.checked ? 'checked' : '', I18n.t(o.label));
            li._item = o;
            list.appendChild(li);
        });
        focus.menu = { r: 0, c: 0, last: {} };
        show('menu');
    }

    function init() {
        register('menu', {
            el: $('menu'),
            overlay: true,
            hints: [['OK', 'Select'], ['Back', 'Close']],
            rows: function () { return children($('menu-list')).map(function (li) { return [li]; }); },
            activate: function (o) {
                show(views.menu.from, { back: true });
                if (o.run) o.run();
            }
        });
        document.addEventListener('keydown', onKey);
        wakeHints();
    }

    window.UI = {
        KEY: KEY,
        $: $,
        el: el,
        children: children,
        clamp: clamp,
        chunk: chunk,
        register: register,
        show: show,
        back: back,
        refresh: refresh,
        setFocus: setFocus,
        focusOn: focusOn,
        resetScroll: resetScroll,
        // For state changes that redraw hints without switching view.
        refreshHints: function () { renderHints(views[current]); },
        toast: toast,
        menu: menu,
        init: init,
        current: function () { return current; },
        isVisible: function (name) { return current === name; },
        setKeyHook: function (fn) { keyHook = fn; },
        setColourKey: function (fn) { colourKey = fn; }
    };
})();
