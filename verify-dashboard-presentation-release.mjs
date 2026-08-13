import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const source = join(root, 'frontdesign-v1');
const criticalAssets = [
  'index.html',
  'api.js',
  'dashboard-adapter.js',
  'dashboard-format.js',
  'dashboard-map.js',
  'dashboard-v2.js',
  'dashboard.css',
  'scripts.js',
  'assets/maps/changchun-service-area.geojson',
];

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else result.push(path);
  }
  return result;
}

const runtime = (await readFile(join(dist, 'runtime-config.js'), 'utf8')).trim();
assert.equal(
  runtime,
  "window.BLACKSOIL_CONFIG = Object.freeze({ apiBase: 'https://api.flexibility607.cn/api/v1', demo: false });",
  'production runtime configuration drifted',
);

const html = await readFile(join(dist, 'index.html'), 'utf8');
for (const marker of [
  '20260813-dashboard-presentation-1',
  'class="dv2-panel dv2-information-panel"',
  'class="dv2-panel dv2-showcase-panel"',
  'id="dv2-algorithm-dialog"',
  '长春市及近郊供销网络',
  '人民币 · B02 移动履约与经营日报',
]) {
  assert.ok(html.includes(marker), `missing production marker: ${marker}`);
}

for (const asset of criticalAssets) {
  const sourceBytes = await readFile(join(source, asset));
  const distBytes = await readFile(join(dist, asset));
  assert.equal(
    createHash('sha256').update(distBytes).digest('hex'),
    createHash('sha256').update(sourceBytes).digest('hex'),
    `${asset} differs between source and production dist`,
  );
}

const map = JSON.parse(await readFile(join(dist, 'assets/maps/changchun-service-area.geojson'), 'utf8'));
assert.equal(map.type, 'FeatureCollection');
assert.equal(map.metadata?.crs, 'EPSG:4326');
assert.equal(map.metadata?.license, 'ODbL 1.0');
assert.deepEqual(map.metadata?.bounds, [125.15, 43.6, 125.6, 44.02]);

const forbidden = [];
for (const path of await filesUnder(dist)) {
  const name = relative(dist, path).replaceAll('\\', '/');
  const lower = name.toLowerCase();
  if (
    lower.startsWith('frontend-mocks-v0.1/')
    || lower.includes('/node_modules/')
    || /(^|\/)(\.env|\.dev\.vars)(\.|$)/i.test(name)
    || /\.(map|pem|key|pfx|p12|sqlite|sqlite3|db)$/i.test(name)
  ) forbidden.push(name);
  assert.ok((await stat(path)).size > 0, `${name} is empty`);
}
assert.deepEqual(forbidden, [], `forbidden production files: ${forbidden.join(', ')}`);

const apiSource = await readFile(join(dist, 'api.js'), 'utf8');
for (const marker of [
  "authPolicy: 'omit'",
  "credentialsPolicy: 'omit'",
  '/public/dashboard/information',
  '/public/dashboard/snapshot',
]) assert.ok(apiSource.includes(marker), `public request contract missing: ${marker}`);

console.log(`E02 production presentation verification passed: ${criticalAssets.length} critical assets.`);
