// Renders a fixed test image with the p5 and GPU renderers for every shape and
// background mode, then fails if they drift apart beyond antialiasing noise.
//
//   npm run compare            (first time: npx playwright install chromium)
//   npm run compare -- --keep  (also writes side-by-side crops to compare-output/)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const DPR = 2;
const KEEP = process.argv.includes('--keep');

// Mean per-pixel channel error allowed (0-255). Measured baselines at DPR 2:
// circle 3.6, square 0.2, diamond 3.6, triangle 3.0, cross 1.0, ring 7.3, backgrounds < 0.2
const LIMITS = {
    '● circle': 6,
    '■ square': 2,
    '◆ diamond': 6,
    '▲ triangle': 5,
    '✚ cross': 3,
    '○ ring': 10,
    'original background': 1,
    'graded background': 1,
};

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dots-compare-'));
console.log('Building...');
execSync('npx react-scripts build', {
    stdio: 'ignore',
    env: { ...process.env, BUILD_PATH: buildDir, PUBLIC_URL: '/', GENERATE_SOURCEMAP: 'false' },
});

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(buildDir, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(buildDir) || !fs.existsSync(file)) file = path.join(buildDir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;

// Software GL keeps results deterministic across machines
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ deviceScaleFactor: DPR, viewport: { width: 1300, height: 900 } });
page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
await page.goto(url);

// Deterministic test image: gradient plus seeded colored blobs
const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 450;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 800, 450);
    g.addColorStop(0, '#123');
    g.addColorStop(0.5, '#f80');
    g.addColorStop(1, '#eef');
    x.fillStyle = g;
    x.fillRect(0, 0, 800, 450);
    let s = 1;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 120; i++) {
        x.fillStyle = `hsl(${i * 37},70%,${20 + (i % 60)}%)`;
        x.beginPath();
        x.arc(r() * 800, r() * 450, 10 + r() * 60, 0, 7);
        x.fill();
    }
    return c.toDataURL('image/png').split(',')[1];
});
await page.setInputFiles('#file-upload', { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
await page.waitForTimeout(1500);

const gpuToggle = page.locator('label:has-text("gpu renderer?") input');
const snapshot = (key) =>
    page.evaluate((key) => {
        const src = document.querySelector('.dots-canvas canvas');
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d').drawImage(src, 0, 0);
        window[key] = c;
    }, key);
const diff = () =>
    page.evaluate(() => {
        const a = window.P5_SNAP;
        const b = window.GPU_SNAP;
        if (a.width !== b.width || a.height !== b.height) {
            return { error: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
        }
        const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
        const db = b.getContext('2d').getImageData(0, 0, a.width, a.height).data;
        let sum = 0;
        for (let i = 0; i < da.length; i += 4) {
            sum += Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        }
        // Side-by-side zoomed crop: p5 left, GPU right
        const zoom = 8;
        const cw = 60 * devicePixelRatio;
        const ch = 40 * devicePixelRatio;
        const o = document.createElement('canvas');
        o.width = cw * zoom * 2 + 10;
        o.height = ch * zoom;
        const x = o.getContext('2d');
        x.imageSmoothingEnabled = false;
        x.fillStyle = '#f00';
        x.fillRect(0, 0, o.width, o.height);
        const at = 200 * devicePixelRatio;
        x.drawImage(a, at, at, cw, ch, 0, 0, cw * zoom, ch * zoom);
        x.drawImage(b, at, at, cw, ch, cw * zoom + 10, 0, cw * zoom, ch * zoom);
        return { meanErr: sum / (da.length / 4), crop: o.toDataURL() };
    });

if (KEEP) fs.mkdirSync('compare-output', { recursive: true });
let failed = false;
const check = async (name) => {
    await page.waitForTimeout(1500);
    await snapshot('P5_SNAP');
    await gpuToggle.check();
    await page.waitForTimeout(1500);
    await snapshot('GPU_SNAP');
    await gpuToggle.uncheck();
    const result = await diff();
    const limit = LIMITS[name];
    const ok = !result.error && result.meanErr <= limit;
    failed ||= !ok;
    const detail = result.error ?? `mean error ${result.meanErr.toFixed(2)} (limit ${limit})`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${detail}`);
    if (KEEP && result.crop) {
        fs.writeFileSync(path.join('compare-output', `${name.replace(/\W+/g, '-')}.png`), Buffer.from(result.crop.split(',')[1], 'base64'));
    }
};

await page.click('text=dots');
for (const shape of ['● circle', '■ square', '◆ diamond', '▲ triangle', '✚ cross', '○ ring']) {
    await page.selectOption('select.control-select >> nth=0', shape);
    await check(shape);
}
await page.selectOption('select.control-select >> nth=0', '● circle');
await page.click('text=background');
await page.check('label:has-text("show original?") input');
await check('original background');
await page.check('label:has-text("apply grading") input');
await check('graded background');

await browser.close();
server.close();
fs.rmSync(buildDir, { recursive: true, force: true });
if (failed) {
    console.log('\nRenderers differ beyond tolerance. Run with --keep to inspect crops.');
    process.exit(1);
}
console.log('\nRenderers match.');
