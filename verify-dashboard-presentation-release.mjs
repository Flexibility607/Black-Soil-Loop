import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const source = join(root, 'frontdesign-v1');
const criticalAssets = [
  'index.html',
  'api.js',
  'dashboard-adapter.js',
  'dashboard-format.js',
  'dashboard-map.js',
  'dashboard-loop.js',
  'dashboard-v2.js',
  'dashboard.css',
  'scripts.js',
  'assets/maps/changchun-service-area.geojson',
  'assets/maps/changchun-road-basemap.v2.geojson',
  'assets/maps/changchun-showcase-routes.v1.json',
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
  '20260814-dashboard-presentation-3',
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

const basemapBytes = await readFile(join(dist, 'assets/maps/changchun-road-basemap.v2.geojson'));
const basemap = JSON.parse(basemapBytes.toString('utf8'));
const basemapHash = createHash('sha256').update(basemapBytes).digest('hex');
assert.equal(basemapHash, '00e3325b010726d78468d6a4439ed6f423ae50a7953b3f2a08f50adce631cdfa');
assert.ok(basemapBytes.byteLength <= 1.5 * 1024 * 1024, 'road basemap exceeds 1.5 MiB');
assert.ok(gzipSync(basemapBytes, { level: 9 }).byteLength <= 250 * 1024, 'road basemap gzip exceeds 250 KiB');
assert.equal(basemap.metadata?.crs, 'EPSG:4326');
assert.equal(basemap.metadata?.coordinate_order, 'longitude,latitude');
assert.equal(basemap.metadata?.license, 'ODbL 1.0');
assert.equal(basemap.metadata?.attribution, '© OpenStreetMap contributors');
assert.deepEqual(basemap.metadata?.clip_bounds, [125.15, 43.6, 125.6, 44.1]);
assert.ok(basemap.features.length <= 800, 'road basemap exceeds 800 features');
const basemapLayers = new Set(basemap.features.map((feature) => feature.properties?.layer));
for (const layer of ['motorway', 'primary', 'secondary', 'railway', 'waterway', 'place_label']) {
  assert.ok(basemapLayers.has(layer), `road basemap is missing ${layer}`);
}
function pointsOf(value) {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) return [value];
  return value.flatMap(pointsOf);
}
const basemapPoints = basemap.features.flatMap((feature) => pointsOf(feature.geometry?.coordinates));
assert.ok(basemapPoints.length <= 12000, 'road basemap exceeds 12,000 coordinate points');
for (const point of basemapPoints) {
  assert.ok(point[0] >= 125.15 && point[0] <= 125.6 && point[1] >= 43.6 && point[1] <= 44.1, 'road basemap coordinate is out of bounds');
}

const showcaseRoutes = JSON.parse(await readFile(join(dist, 'assets/maps/changchun-showcase-routes.v1.json'), 'utf8'));
assert.equal(showcaseRoutes.routes?.length, 5);
assert.match(showcaseRoutes.disclaimer, /预设路线演示/);
assert.match(showcaseRoutes.disclaimer, /不代表实时履约或道路导航/);
assert.ok(showcaseRoutes.routes.every((route) => Array.isArray(route.coordinates) && route.coordinates.length >= 2));
assert.ok(!/(?:vehicle_id|driver_id|object_version|license_plate|telemetry)/i.test(JSON.stringify(showcaseRoutes)));

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

const browserSources = await Promise.all(['index.html', 'api.js', 'scripts.js', 'dashboard-v2.js', 'dashboard-map.js', 'dashboard.css']
  .map((name) => readFile(join(dist, name), 'utf8')));
for (const marker of ['webapi.amap.com', 'maps.googleapis.com', 'api.map.baidu.com', 'tile.openstreetmap.org', 'mapboxgl.accessToken']) {
  assert.ok(!browserSources.join('\n').includes(marker), `online map runtime marker found: ${marker}`);
}

console.log(`E02 production presentation verification passed: ${criticalAssets.length} critical assets.`);
