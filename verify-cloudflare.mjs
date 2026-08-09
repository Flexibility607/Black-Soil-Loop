import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const mockDir = join(projectRoot, 'frontend-mocks-v0.1');
const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:8787/');

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
for (const marker of ['id="public-screen-canvas"', 'id="public-theme-toggle"', 'id="dv2-brand-logo"', 'id="dv2-order-donut"', 'id="dv2-sales-donut"', 'id="dv2-mic-button"']) {
  if (!html.includes(marker)) throw new Error(`The deployed page is missing ${marker}.`);
}

for (const path of ['/styles.css', '/dashboard.css', '/api.js', '/scripts.js', '/dashboard-v2.js', '/assets/brand/jipin-screen-light-d0308f92.jpg', '/assets/brand/jipin-web-green-e90c36ef.jpg', '/assets/brand/jipin-screen-dark-e041ecf5.jpg', '/vendor/echarts/echarts.min.js', '/assets/maps/northeast-china-admin1.geojson', '/assets/backgrounds/northeast-winter-corn-v1.webp']) {
  const content = await (await requireOk(path)).text();
  if (content.length < 100) throw new Error(`${path} is unexpectedly empty.`);
}

const productionSource = await Promise.all(['/index.html', '/api.js', '/scripts.js', '/dashboard-v2.js', '/dashboard.css'].map(async (path) => (await requireOk(path)).text()));
for (const marker of ['localhost', 'openstreetmap', 'fonts.googleapis', 'cdnjs', 'unpkg.com', 'jsdelivr']) {
  if (productionSource.join('\n').toLowerCase().includes(marker)) throw new Error(`Production bundle contains banned marker: ${marker}.`);
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
