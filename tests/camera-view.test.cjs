const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/camera-view.js', 'utf8');
const nodes = {};
function node(id) {
    if (!nodes[id]) nodes[id] = {
        id, children: [], classList: { values: new Set(), add(x) { this.values.add(x); }, remove(x) { this.values.delete(x); }, contains(x) { return this.values.has(x); }, toggle(x, force) { if (force) this.add(x); else this.remove(x); } },
        appendChild(child) { this.children.push(child); },
        querySelector(tag) { return this.children.find(child => child.tag === tag); },
        removeAttribute() {}, addEventListener() {},
        set innerHTML(value) { this.children = []; },
        set textContent(value) { this.text = value; }
    };
    return nodes[id];
}
const views = {};
const config = { cameraServer: 'http://10.0.0.2:8765', cameras: ['front', 'back', 'side', 'door', 'yard', 'garage', 'hall'] };
const ctx = {
    window: { LAUNCHER_CONFIG: config },
    document: { addEventListener() {}, hidden: false },
    setTimeout: () => 1, clearTimeout() {},
    UI: {
        $: node, el: (tag, klass, text) => { const element = node('new-' + Math.random()); element.tag = tag; element.className = klass; element.textContent = text; return element; },
        children: element => element.children,
        chunk: (items, size) => { const rows = []; for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size)); return rows; },
        register: (name, view) => { views[name] = view; },
        show: name => { views[name].onShow(); }, refresh() {}, isVisible: () => true
    }
};
vm.runInNewContext(source, ctx);
const cameras = ctx.window.CameraView;
assert.equal(cameras.snapshotUrl(config.cameraServer, 'front', 123), 'http://10.0.0.2:8765/snapshot/front.jpg?t=123');
for (const base of ['https://example.com', 'http://8.8.8.8:8765', 'http://10.0.0.2:99999', 'http://010.0.0.2:8765']) {
    assert.throws(() => cameras.snapshotUrl(base, 'front', 1));
}
assert.throws(() => cameras.snapshotUrl(config.cameraServer, '../secret', 1));
assert.equal(cameras.isConfigured(), true);
cameras.init(); cameras.openWall();
assert.equal(node('cameras').classList.contains('wall-mode'), true);
assert.equal(node('camera-grid').children.length, 7);
assert.equal(views.cameras.rows().length, 2);
config.cameraServer = null;
assert.equal(cameras.isConfigured(), false);
console.log('camera URL guards, opt-in and wall OK');
