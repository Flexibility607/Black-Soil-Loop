import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOUNDS = [125.15, 43.60, 125.60, 44.10];
const LABEL_NAMES = new Set([
  '长春市', '朝阳区', '南关区', '宽城区', '二道区', '绿园区',
  '净月街道', '长春净月高新技术产业开发区', '长春汽车经济技术开发区',
  '长春北湖科技开发区', '长春高新技术产业开发区',
]);
const ROAD_LAYERS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
]);
const V2_PRIMARY_NAMES = new Set([
  '人民大街', '亚泰大街', '远达大街', '新城大街', '生态大街', '东南湖大路',
  '卫星路', '北环城路', '南环城路', '西环城路', '开运街', '硅谷大街',
  '吉林大路', '南湖大路', '工农大路', '景阳大路', '自由大路', '解放大路',
  '长白公路', '东风大街', '前进大街', '西安大路', '皓月大路', '机场路',
]);
const V2_SECONDARY_NAMES = new Set([
  '临河街', '富锦路', '福祉大路', '聚业大街', '城南大路', '生态东街',
  '世纪大街', '博学路', '飞跃路', '繁荣路', '湖畔街', '长伊线',
]);
const V2_RAILWAY_NAMES = new Set(['京哈线', '长图线', '长白线', '长珲城际线']);
const TOLERANCE = Object.freeze({
  motorway: 0.00012, motorway_link: 0.00008, trunk: 0.00012, trunk_link: 0.00008,
  primary: 0.0001, primary_link: 0.00007, secondary: 0.00009, secondary_link: 0.00006,
  tertiary: 0.00007, tertiary_link: 0.00005, railway: 0.0001, waterway: 0.00008,
});

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (!dx && !dy) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointSegmentDistance(points[index], points[0], points.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, splitIndex + 1), tolerance).slice(0, -1), ...simplify(points.slice(splitIndex), tolerance)];
}

function clipSegment(start, end) {
  const [minX, minY, maxX, maxY] = BOUNDS;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let lower = 0;
  let upper = 1;
  for (const [p, q] of [[-dx, start[0] - minX], [dx, maxX - start[0]], [-dy, start[1] - minY], [dy, maxY - start[1]]]) {
    if (p === 0 && q < 0) return null;
    if (p === 0) continue;
    const ratio = q / p;
    if (p < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return null;
  }
  return [
    [start[0] + lower * dx, start[1] + lower * dy],
    [start[0] + upper * dx, start[1] + upper * dy],
  ].map((point) => point.map((value) => Number(value.toFixed(7))));
}

function samePoint(left, right) {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}

function clipLine(points) {
  const fragments = [];
  let active = [];
  for (let index = 1; index < points.length; index += 1) {
    const clipped = clipSegment(points[index - 1], points[index]);
    if (!clipped) {
      if (active.length > 1) fragments.push(active);
      active = [];
      continue;
    }
    if (!active.length) active.push(clipped[0], clipped[1]);
    else if (samePoint(active.at(-1), clipped[0])) active.push(clipped[1]);
    else {
      if (active.length > 1) fragments.push(active);
      active = [clipped[0], clipped[1]];
    }
  }
  if (active.length > 1) fragments.push(active);
  return fragments;
}

function layerFor(element) {
  const tags = element.tags || {};
  if (ROAD_LAYERS.has(tags.highway)) return tags.highway.replace('_link', '');
  if (['rail', 'light_rail'].includes(tags.railway)) return 'railway';
  if (['river', 'canal', 'stream'].includes(tags.waterway)) return 'waterway';
  if (tags.boundary === 'administrative') return 'district_boundary';
  return null;
}

function featureName(tags = {}) {
  return String(tags['name:zh'] || tags.name || tags.ref || '').trim() || null;
}

function wayFeatures(element) {
  const layer = layerFor(element);
  if (!layer || !Array.isArray(element.geometry)) return [];
  const points = element.geometry.map((point) => [Number(point.lon), Number(point.lat)]).filter((point) => point.every(Number.isFinite));
  if (points.length < 2) return [];
  return clipLine(points).map((fragment, index) => ({
    type: 'Feature',
    properties: { layer, name: featureName(element.tags), fragment: index },
    geometry: { type: 'LineString', coordinates: simplify(fragment, TOLERANCE[layer] || 0.00008) },
  })).filter((feature) => feature.geometry.coordinates.length > 1 && !samePoint(feature.geometry.coordinates[0], feature.geometry.coordinates.at(-1)));
}

function labelFeature(element) {
  const name = featureName(element.tags);
  const coordinates = [Number(element.lon), Number(element.lat)];
  if (!LABEL_NAMES.has(name) || !coordinates.every(Number.isFinite)) return null;
  if (coordinates[0] < BOUNDS[0] || coordinates[0] > BOUNDS[2] || coordinates[1] < BOUNDS[1] || coordinates[1] > BOUNDS[3]) return null;
  return {
    type: 'Feature',
    properties: { layer: 'place_label', name },
    geometry: { type: 'Point', coordinates },
  };
}

function sortFeatures(left, right) {
  const leftKey = `${left.properties.layer}\0${left.properties.name || ''}\0${JSON.stringify(left.geometry.coordinates)}`;
  const rightKey = `${right.properties.layer}\0${right.properties.name || ''}\0${JSON.stringify(right.geometry.coordinates)}`;
  return leftKey.localeCompare(rightKey, 'en');
}

function v2Keep(feature) {
  const { layer, name } = feature.properties || {};
  if (layer === 'place_label' || layer === 'waterway' || layer === 'district_boundary' || layer === 'service_boundary') return true;
  if (layer === 'motorway' || layer === 'trunk') return Boolean(name);
  if (layer === 'primary') return V2_PRIMARY_NAMES.has(name);
  if (layer === 'secondary' || layer === 'tertiary') return V2_SECONDARY_NAMES.has(name);
  if (layer === 'railway') return V2_RAILWAY_NAMES.has(name);
  return false;
}

function dissolveFeatures(features) {
  const points = [];
  const groups = new Map();
  for (const feature of features.filter(v2Keep)) {
    if (feature.geometry.type === 'Point' || feature.geometry.type === 'Polygon') {
      points.push(feature);
      continue;
    }
    const key = `${feature.properties.layer}\0${feature.properties.name || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature.geometry.coordinates);
  }
  const lines = [...groups].map(([key, coordinates]) => {
    const [layer, name] = key.split('\0');
    const partCap = ({ motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, railway: 5, waterway: 5, district_boundary: 5 })[layer] || 4;
    const selected = coordinates
      .map((line) => ({ line, length: line.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0) }))
      .sort((left, right) => right.length - left.length || JSON.stringify(left.line).localeCompare(JSON.stringify(right.line), 'en'))
      .slice(0, partCap)
      .map((item) => item.line)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
    return {
      type: 'Feature',
      properties: { layer, name: name || null },
      geometry: selected.length === 1
        ? { type: 'LineString', coordinates: selected[0] }
        : { type: 'MultiLineString', coordinates: selected },
    };
  });
  return [...lines, ...points].sort(sortFeatures);
}

function supplementalNorthFeatures() {
  return [{
    type: 'Feature',
    properties: { layer: 'service_boundary', name: '长春市及近郊服务范围' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [125.15, 44.09], [125.15, 43.82], [125.19, 43.70], [125.28, 43.62],
        [125.42, 43.60], [125.54, 43.64], [125.60, 43.72], [125.60, 43.87],
        [125.56, 43.98], [125.50, 44.02], [125.30, 44.02], [125.20, 44.09],
        [125.15, 44.09],
      ]],
    },
  }, {
    type: 'Feature',
    properties: { layer: 'trunk', name: '北青年路' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [125.1711273, 44.0872187], [125.1723744, 44.0824075], [125.1733559, 44.0784428],
        [125.1744733, 44.0731074], [125.1752583, 44.0690937], [125.1766265, 44.0619234],
        [125.1826365, 44.0527908], [125.1905, 44.043], [125.202, 44.0305], [125.213, 44.018],
      ],
    },
  }];
}

async function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const sourceDir = resolve(argument('--source-dir', join(root, '..', '..', 'release-artifacts', 'changchun-basemap-source-20260813')));
  const output = resolve(argument('--output', join(root, 'frontdesign-v1', 'assets', 'maps', 'changchun-road-basemap.v2.geojson')));
  const sourceDate = argument('--source-date', '2026-08-13');
  const sourceFiles = (await readdir(sourceDir)).filter((name) => /^(roads-(nw|ne|sw|se)|context)\.json$/.test(name)).sort();
  if (sourceFiles.length !== 5) throw new Error(`expected 5 source files, found ${sourceFiles.length}`);
  const sourceHashes = [];
  const seenElements = new Set();
  const features = [];
  for (const name of sourceFiles) {
    const bytes = await readFile(join(sourceDir, name));
    sourceHashes.push(`${name}:${sha256(bytes)}`);
    const document = JSON.parse(bytes.toString('utf8'));
    for (const element of document.elements || []) {
      const key = `${element.type}:${element.id}`;
      if (seenElements.has(key)) continue;
      seenElements.add(key);
      if (element.type === 'way') features.push(...wayFeatures(element));
      if (element.type === 'node') {
        const label = labelFeature(element);
        if (label) features.push(label);
      }
    }
  }
  const v2Features = dissolveFeatures([...features, ...supplementalNorthFeatures()]);
  const layers = new Set(v2Features.map((feature) => feature.properties.layer));
  for (const required of ['motorway', 'primary', 'secondary', 'railway', 'waterway', 'place_label']) {
    if (!layers.has(required)) throw new Error(`required basemap layer missing: ${required}`);
  }
  const sourceSha256 = sha256(sourceHashes.join('\n'));
  const outputDocument = {
    type: 'FeatureCollection',
    name: 'changchun-road-basemap-v2',
    metadata: {
      crs: 'EPSG:4326', coordinate_order: 'longitude,latitude',
      source_url: 'https://overpass-api.de/ and compatible Overpass API instances',
      source_date: sourceDate, source_sha256: sourceSha256,
      source_files: sourceHashes, license: 'ODbL 1.0',
      attribution: '© OpenStreetMap contributors', clip_bounds: BOUNDS,
      simplification_method: 'Douglas-Peucker after Liang-Barsky clipping',
      simplification_tolerance_degrees: TOLERANCE,
      supplemental_source: 'OpenStreetMap way geometry for 北青年路, queried 2026-08-14',
      generator_version: 'build-changchun-basemap-v2',
    },
    features: v2Features,
  };
  const serialized = `${JSON.stringify(outputDocument)}\n`;
  await writeFile(output, serialized, 'utf8');
  const coordinateCount = v2Features.reduce((sum, feature) => {
    const coordinates = feature.geometry.coordinates;
    if (feature.geometry.type === 'Point') return sum + 1;
    if (feature.geometry.type === 'LineString') return sum + coordinates.length;
    if (feature.geometry.type === 'Polygon') return sum + coordinates.reduce((subtotal, ring) => subtotal + ring.length, 0);
    return sum + coordinates.reduce((subtotal, line) => subtotal + line.length, 0);
  }, 0);
  if (v2Features.length > 800 || coordinateCount > 12000 || Buffer.byteLength(serialized) > 1572864) {
    throw new Error(`v2 release gates failed features=${v2Features.length} coordinates=${coordinateCount} bytes=${Buffer.byteLength(serialized)}`);
  }
  process.stdout.write(`${basename(output)} ${Buffer.byteLength(serialized)} bytes sha256=${sha256(serialized)} features=${v2Features.length} coordinates=${coordinateCount}\n`);
}

await main();
