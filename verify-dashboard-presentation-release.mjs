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
  'assets/maps/changchun-road-basemap.v3.geojson',
  'assets/maps/changchun-road-basemap.v4.geojson',
  'assets/maps/changchun-showcase-routes.v1.json',
  'assets/maps/changchun-showcase-routes.v2.json',
  'assets/maps/changchun-showcase-routes.v3.json',
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
  '20260815-fixed-showcase-1',
  '20260814-dashboard-presentation-5',
  'class="dv2-panel dv2-information-panel"',
  'class="dv2-panel dv2-showcase-panel"',
  'id="dv2-algorithm-dialog"',
  '长春市及近郊供销网络',
  '人民币 · B02 移动履约与经营日报',
  'id="dv2-map-zoom-in"',
  'id="dv2-map-overview"',
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

const basemapBytes = await readFile(join(dist, 'assets/maps/changchun-road-basemap.v4.geojson'));
const basemap = JSON.parse(basemapBytes.toString('utf8'));
const basemapHash = createHash('sha256').update(basemapBytes).digest('hex');
assert.equal(basemapHash, '24de7f4e4c38e3d169fa179b95bae194c5b7c33c3f411cb0b3df0ce4834330e4');
assert.ok(basemapBytes.byteLength <= 750 * 1024, 'road basemap exceeds 750 KiB');
assert.ok(gzipSync(basemapBytes, { level: 9 }).byteLength <= 200 * 1024, 'road basemap gzip exceeds 200 KiB');
assert.equal(basemap.metadata?.crs, 'EPSG:4326');
assert.equal(basemap.metadata?.coordinate_order, 'longitude,latitude');
assert.equal(basemap.metadata?.license, 'ODbL 1.0');
assert.equal(basemap.metadata?.attribution, '© OpenStreetMap contributors');
assert.deepEqual(basemap.metadata?.clip_bounds, [125.15, 43.6, 125.6, 44.1]);
assert.ok(basemap.features.length >= 450 && basemap.features.length <= 650, 'road basemap feature gate failed');
const basemapLayers = new Set(basemap.features.map((feature) => feature.properties?.layer));
for (const layer of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'route_connector', 'railway', 'waterway', 'district_boundary', 'place_label', 'road_label']) {
  assert.ok(basemapLayers.has(layer), `road basemap is missing ${layer}`);
}
function pointsOf(value) {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) return [value];
  return value.flatMap(pointsOf);
}
const pointKey = (point) => `${Number(point[0]).toFixed(7)},${Number(point[1]).toFixed(7)}`;
const edgeKey = (start, end) => {
  const first = pointKey(start);
  const second = pointKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};
const edgesOf = (coordinates) => coordinates.slice(1).map((point, index) => edgeKey(coordinates[index], point));
const radians = (degrees) => degrees * Math.PI / 180;
const lineLengthKm = (coordinates) => coordinates.slice(1).reduce((total, point, index) => {
  const previous = coordinates[index];
  const dLat = radians(point[1] - previous[1]);
  const dLon = radians(point[0] - previous[0]);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(previous[1])) * Math.cos(radians(point[1])) * Math.sin(dLon / 2) ** 2;
  return total + 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}, 0);
const basemapPoints = basemap.features.flatMap((feature) => pointsOf(feature.geometry?.coordinates));
assert.ok(basemapPoints.length >= 6000 && basemapPoints.length <= 10000, 'road basemap coordinate gate failed');
for (const point of basemapPoints) {
  assert.ok(point[0] >= 125.15 && point[0] <= 125.6 && point[1] >= 43.6 && point[1] <= 44.1, 'road basemap coordinate is out of bounds');
}

const showcaseRoutes = JSON.parse(await readFile(join(dist, 'assets/maps/changchun-showcase-routes.v3.json'), 'utf8'));
const legacyRoutes = JSON.parse(await readFile(join(dist, 'assets/maps/changchun-showcase-routes.v2.json'), 'utf8'));
assert.equal(showcaseRoutes.schema_version, '3.0');
assert.equal(showcaseRoutes.routes?.length, 5);
assert.match(showcaseRoutes.disclaimer, /预设路线演示/);
assert.match(showcaseRoutes.disclaimer, /不代表实时履约或道路导航/);
assert.ok(Array.isArray(showcaseRoutes.corridors) && showcaseRoutes.corridors.length > 5);
assert.equal(new Set(showcaseRoutes.corridors.map((corridor) => JSON.stringify(corridor.coordinates))).size, showcaseRoutes.corridors.length);
assert.ok(showcaseRoutes.routes.every((route) => Array.isArray(route.corridor_keys) && route.corridor_keys.length > 0));
assert.ok(showcaseRoutes.routes.every((route) => Array.isArray(route.detail_corridor_keys) && route.detail_corridor_keys.length > 0));
assert.ok(showcaseRoutes.routes.every((route) => route.origin_snap_distance_m <= 100 && route.destination_snap_distance_m <= 100));
assert.ok(showcaseRoutes.routes.every((route) => route.detail_distance_km >= 10 && route.detail_distance_km <= 15));
assert.ok(showcaseRoutes.routes.every((route) => route.full_focus.zoom >= 1 && route.full_focus.zoom <= 6));
assert.ok(showcaseRoutes.routes.every((route) => route.detail_focus.zoom >= 1.4 && route.detail_focus.zoom <= 6));
const corridorByKey = new Map(showcaseRoutes.corridors.map((corridor) => [corridor.corridor_key, corridor]));
const corridorEdges = new Set();
for (const corridor of showcaseRoutes.corridors) {
  for (const edge of edgesOf(corridor.coordinates)) {
    assert.equal(corridorEdges.has(edge), false, `route corridor edge is duplicated: ${corridor.corridor_key}`);
    corridorEdges.add(edge);
  }
}
const visibleConnectorEdges = new Set(basemap.features
  .filter((feature) => feature.properties?.layer === 'route_connector')
  .flatMap((feature) => edgesOf(feature.geometry.coordinates)));
for (const corridor of showcaseRoutes.corridors.filter((item) => item.kind !== 'ENTRANCE')) {
  for (const edge of edgesOf(corridor.coordinates)) {
    assert.ok(visibleConnectorEdges.has(edge), `route corridor is missing from the visible basemap: ${corridor.corridor_key}`);
  }
}
for (const route of showcaseRoutes.routes) {
  const reconstructed = route.corridor_keys.flatMap((key, index) => {
    const coordinates = corridorByKey.get(key)?.coordinates || [];
    return index === 0 ? coordinates : coordinates.slice(1);
  });
  const previousRoute = legacyRoutes.routes.find((item) => item.route_no === route.route_no);
  assert.deepEqual(reconstructed.at(-1), previousRoute.coordinates.at(-1));
  assert.ok(Math.abs(lineLengthKm(reconstructed) - lineLengthKm(previousRoute.coordinates)) / lineLengthKm(previousRoute.coordinates) < 0.01);
}
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
