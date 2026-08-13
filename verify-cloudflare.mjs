import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const mockDir = join(projectRoot, 'frontend-mocks-v0.1');
const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:8787/');
const brandAssets = Object.freeze({
  '/assets/brand/jipin-screen-light-d0308f92.jpg': 'D0308F92B54FCFCB783886704A7A1E85B1853B724784FB89BC0E9A79425211F8',
  '/assets/brand/jipin-web-green-e90c36ef.jpg': 'E90C36EF7F198C1C1E4EE2FCDD517C09B71842D11CD1AF2764F27AED1EB131FE',
  '/assets/brand/jipin-screen-dark-e041ecf5.jpg': 'E041ECF5C6ADD12F257F3CC07F862BE9B8DA9797477362C6C22EAA53709B069F',
});
const moduleAssets = Object.freeze([
  '/dashboard-audio-worklet.js',
  '/dashboard-wav-worker.js',
  '/dashboard-voice.js',
]);

if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  throw new Error('The verification URL must use http or https.');
}

const mockFiles = (await readdir(mockDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort();

async function request(path) {
  const url = new URL(path, baseUrl);
  return fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
}

async function requireOk(path) {
  const response = await request(path);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
  return response;
}

const html = await (await requireOk('/')).text();
const runtimeConfig = await (await requireOk('/runtime-config.js')).text();
if (!/apiBase:\s*['"]\/api\/v1['"]/.test(runtimeConfig) || !/demo:\s*true/.test(runtimeConfig)) {
  throw new Error('The demo runtime must use same-origin /api/v1 with demo:true.');
}
if (runtimeConfig.includes('api.flexibility607.cn')) {
  throw new Error('The demo runtime must not point to the production API.');
}
for (const marker of ['id="public-screen-canvas"', 'id="public-theme-toggle"', 'id="dv2-brand-logo"', 'id="dv2-order-donut"', 'id="dv2-sales-donut"', 'id="dv2-mic-button"']) {
  if (!html.includes(marker)) throw new Error(`The deployed page is missing ${marker}.`);
}
for (const marker of ['id="toggle-mock"', 'jipin-logo.jpg']) {
  if (html.includes(marker)) throw new Error(`The deployed page contains retired marker: ${marker}.`);
}

for (const path of ['/styles.css', '/dashboard.css', '/api.js', '/scripts.js', '/dashboard-v2.js', ...moduleAssets, '/vendor/echarts/echarts.min.js', '/assets/maps/northeast-china-admin1.geojson', '/assets/maps/changchun-service-area.geojson', '/assets/backgrounds/northeast-winter-corn-v1.webp']) {
  const content = await (await requireOk(path)).text();
  if (content.length < 100) throw new Error(`${path} is unexpectedly empty.`);
}

for (const path of moduleAssets) {
  const sourceBytes = await readFile(join(projectRoot, 'frontdesign-v1', path.slice(1)));
  const deployedBytes = new Uint8Array(await (await requireOk(path)).arrayBuffer());
  const expectedHash = createHash('sha256').update(sourceBytes).digest('hex');
  const actualHash = createHash('sha256').update(deployedBytes).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`${path} differs from the tested source module.`);
}

for (const [path, expectedHash] of Object.entries(brandAssets)) {
  const bytes = new Uint8Array(await (await requireOk(path)).arrayBuffer());
  if (bytes.byteLength < 100) throw new Error(`${path} is unexpectedly empty.`);
  const actualHash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (actualHash !== expectedHash) throw new Error(`${path} failed SHA-256 verification.`);
}

const retiredLogo = await request('/jipin-logo.jpg');
if (retiredLogo.status !== 404) {
  throw new Error(`The retired Logo should return 404, received ${retiredLogo.status}.`);
}

const productionSource = await Promise.all(['/index.html', '/api.js', '/scripts.js', '/dashboard-v2.js', '/dashboard.css', ...moduleAssets].map(async (path) => (await requireOk(path)).text()));
for (const marker of ['localhost', 'fonts.googleapis', 'cdnjs', 'unpkg.com', 'jsdelivr']) {
  if (productionSource.join('\n').toLowerCase().includes(marker)) throw new Error(`Production bundle contains banned marker: ${marker}.`);
}

const changchunMap = await (await requireOk('/assets/maps/changchun-service-area.geojson')).json();
if (changchunMap?.metadata?.crs !== 'EPSG:4326' || changchunMap?.metadata?.license !== 'ODbL 1.0') {
  throw new Error('The local Changchun map is missing WGS84 or ODbL metadata.');
}

for (const name of mockFiles) {
  const response = await requireOk(`/frontend-mocks-v0.1/${name}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data')) {
    throw new Error(`${name} is not a valid Mock response envelope.`);
  }
}

const missing = await request('/frontend-mocks-v0.1/__missing__.json');
if (missing.status !== 404) {
  throw new Error(`A missing Mock file should return 404, received ${missing.status}.`);
}

console.log(`Cloud Mock verification passed: ${baseUrl.origin}, ${mockFiles.length} JSON files.`);
