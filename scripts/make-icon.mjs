// Writes src/icon.png (512x512) with no dependencies.
// Geometric Arn0 monogram: bold A + zero, soft blue underline on deep navy.
// Skips when src/icon.png already exists unless FORCE=1 (build.sh only calls this when missing).
import { existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const out = resolve(import.meta.dirname, '..', 'src', 'icon.png');
if (existsSync(out) && process.env.FORCE !== '1') {
    console.log('Keeping existing', out, '(set FORCE=1 to overwrite)');
    process.exit(0);
}

const size = 512;
const bg = [11, 18, 32];
const fg = [245, 246, 248];
const accent = [58, 123, 213];

function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0]; const yi = pts[i][1];
        const xj = pts[j][0]; const yj = pts[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function inRing(x, y, cx, cy, rOut, rIn) {
    const d = Math.hypot(x - cx, y - cy);
    return d <= rOut && d >= rIn;
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
    if (x >= x0 + r && x < x1 - r) return true;
    if (y >= y0 + r && y < y1 - r) return true;
    const corners = [
        [x0 + r, y0 + r], [x1 - r, y0 + r],
        [x0 + r, y1 - r], [x1 - r, y1 - r]
    ];
    for (const [cx, cy] of corners) {
        if (Math.hypot(x - cx, y - cy) <= r) {
            if (x < x0 + r && y < y0 + r && cx === x0 + r && cy === y0 + r) return true;
            if (x >= x1 - r && y < y0 + r && cx === x1 - r && cy === y0 + r) return true;
            if (x < x0 + r && y >= y1 - r && cx === x0 + r && cy === y1 - r) return true;
            if (x >= x1 - r && y >= y1 - r && cx === x1 - r && cy === y1 - r) return true;
        }
    }
    return (x >= x0 + r && x < x1 - r) || (y >= y0 + r && y < y1 - r);
}

// Left stroke of A, right stroke of A, crossbar (as thick trapezoids).
const left = [[118, 360], [168, 360], [248, 118], [208, 118]];
const right = [[248, 118], [288, 118], [238, 360], [188, 360]];
const bar = [[168, 268], [268, 268], [262, 302], [174, 302]];

function pixel(x, y) {
    // Soft blue underline
    if (inRoundRect(x, y, 150, 392, 362, 412, 8)) return accent;
    // Zero (right of the A)
    if (inRing(x, y, 352, 268, 78, 48)) return fg;
    // A
    if (inPoly(x, y, left) || inPoly(x, y, right) || inPoly(x, y, bar)) return fg;
    return bg;
}

const raw = Buffer.alloc((size * 3 + 1) * size);
for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
        const [r, g, b] = pixel(x, y);
        raw.set([r, g, b], row + 1 + x * 3);
    }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 2;

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
]);

writeFileSync(out, png);
console.log('Wrote', out);
