// Serves src/ for desktop preview. Arrow keys + Enter navigate, Esc/Backspace = Back.
// Also proxies Bing / NASA APOD / Unsplash so Live wallpapers can fetch despite browser CORS.
import { createServer } from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'src');

// index.html always loads the gitignored local overrides; make sure there is something to load.
const localConfig = join(root, 'js', 'config.local.js');
try {
    await access(localConfig);
} catch {
    await writeFile(localConfig, '/* No local overrides. See config.local.example.js. */\n');
}
const port = Number(process.env.PORT) || 8080;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml'
};

const UNSPLASH_API = 'https://api.unsplash.com';

async function proxyJson(res, url, headers) {
    try {
        const upstream = await fetch(url, {
            headers: Object.assign({ Accept: 'application/json' }, headers || {}),
            signal: AbortSignal.timeout(15000)
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        res.end(body);
    } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
    }
}

createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const path = decodeURIComponent(u.pathname);

    if (path === '/api/live/bing') {
        const idx = u.searchParams.get('idx') || '0';
        const n = u.searchParams.get('n') || '1';
        const mkt = u.searchParams.get('mkt') || 'en-GB';
        const url = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=' +
            encodeURIComponent(idx) + '&n=' + encodeURIComponent(n) +
            '&mkt=' + encodeURIComponent(mkt);
        await proxyJson(res, url);
        return;
    }

    if (path === '/api/live/apod') {
        // Raw APOD page; the browser parses it the same way it does on the TV.
        const date = u.searchParams.get('date') || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.writeHead(400).end();
            return;
        }
        const d = date.split('-');
        try {
            const upstream = await fetch(`https://apod.nasa.gov/apod/ap${d[0].slice(2)}${d[1]}${d[2]}.html`, {
                signal: AbortSignal.timeout(15000)
            });
            res.writeHead(upstream.status, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (e) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(String(e && e.message ? e.message : e));
        }
        return;
    }

    if (path === '/api/live/immich') {
        // Preview only: the Immich server is not CORS-enabled for the browser preview origin.
        const target = new URL(u.searchParams.get('url') || '');
        const allowed = ['/api/shared-links/me', '/api/search/metadata'];
        if (!/^https?:$/.test(target.protocol) || !allowed.some((p) => target.pathname.endsWith(p))) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'url not allowed' }));
            return;
        }
        const post = req.method === 'POST';
        let body;
        if (post) {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            body = Buffer.concat(chunks);
        }
        try {
            const upstream = await fetch(target.toString(), {
                method: post ? 'POST' : 'GET',
                headers: post ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
                body,
                signal: AbortSignal.timeout(15000)
            });
            res.writeHead(upstream.status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (e) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
        }
        return;
    }

    if (path === '/api/live/unsplash') {
        const auth = req.headers.authorization || '';
        if (!/^Client-ID\s+\S+/i.test(auth)) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Unsplash Access Key required' }));
            return;
        }
        // Only Unsplash photo endpoints may be reached through the proxy.
        const target = new URL(u.searchParams.get('path') || '', UNSPLASH_API);
        if (target.origin !== UNSPLASH_API || !target.pathname.startsWith('/photos/')) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'path not allowed' }));
            return;
        }
        await proxyJson(res, target.toString(), { Authorization: auth });
        return;
    }

    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    } catch {
        res.writeHead(404).end('Not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`Preview: http://localhost:${port}`);
});
