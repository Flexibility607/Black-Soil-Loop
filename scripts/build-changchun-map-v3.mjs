import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP_BOUNDS = Object.freeze([125.15, 43.60, 125.60, 44.10]);
const ROUTE_BOUNDS = Object.freeze([125.10, 43.55, 125.65, 44.15]);
const SOURCE_FILES = Object.freeze([
  'roads-ne.json', 'roads-nw.json', 'roads-se.json', 'roads-sw.json',
  'context.json', 'route-connectors.json',
]);
const ROUTABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'service',
]);
const BASEMAP_ROADS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
]);
const ROAD_LAYER = Object.freeze({
  motorway: 'motorway', motorway_link: 'motorway',
  trunk: 'trunk', trunk_link: 'trunk',
  primary: 'primary', primary_link: 'primary',
  secondary: 'secondary', secondary_link: 'secondary',
  tertiary: 'tertiary', tertiary_link: 'tertiary',
});
const ROAD_PRIORITY = Object.freeze({ motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4 });
const DISPLAY_ROUTES = Object.freeze([
  { route_no: '01', destination_name: '这有山', destination_type: 'THIRD_SPACE', destination: [125.28612, 43.86884] },
  { route_no: '02', destination_name: '净月潭', destination_type: 'THIRD_SPACE', destination: [125.44888, 43.79942] },
  { route_no: '03', destination_name: '国信南山温泉', destination_type: 'THIRD_SPACE', destination: [125.52170, 43.68356] },
  { route_no: '04', destination_name: '柏记水饺临河街店', destination_type: 'TRADITIONAL_STORE', destination: [125.36920, 43.84690] },
  { route_no: '05', destination_name: '鹤记生煎富锦路店', destination_type: 'TRADITIONAL_STORE', destination: [125.30370, 43.86620] },
]);
const ORIGIN = Object.freeze({
  display_name: '新安食品产业园（西门）',
  address: '长春市农安县合隆镇北青年路9999号（公开地址入口近似点）',
  longitude: 125.1711273,
  latitude: 44.0872187,
  coordinate_accuracy: 'ADDRESS_APPROXIMATE',
  verification_note: '公开监管资料确认园区位于合隆镇长春农安经济开发区；坐标取北青年路公开 OSM 道路线位的地址入口近似点。',
});

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function coordinateKey(point) {
  return `${Number(point[0]).toFixed(7)},${Number(point[1]).toFixed(7)}`;
}

function samePoint(left, right) {
  return coordinateKey(left) === coordinateKey(right);
}

function haversineMeters(left, right) {
  const radians = Math.PI / 180;
  const latitudeDelta = (right[1] - left[1]) * radians;
  const longitudeDelta = (right[0] - left[0]) * radians;
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(left[1] * radians) * Math.cos(right[1] * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(value));
}

function localPoint(point, referenceLatitude) {
  const radians = Math.PI / 180;
  return [point[0] * 111320 * Math.cos(referenceLatitude * radians), point[1] * 110540];
}

function pointSegmentDistanceMeters(point, start, end) {
  const referenceLatitude = (point[1] + start[1] + end[1]) / 3;
  const [px, py] = localPoint(point, referenceLatitude);
  const [sx, sy] = localPoint(start, referenceLatitude);
  const [ex, ey] = localPoint(end, referenceLatitude);
  const dx = ex - sx;
  const dy = ey - sy;
  if (!dx && !dy) return Math.hypot(px - sx, py - sy);
  const ratio = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (sx + ratio * dx), py - (sy + ratio * dy));
}

function simplify(points, toleranceMeters = 12) {
  if (points.length <= 2) return points;
  let maximum = 0;
  let split = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointSegmentDistanceMeters(points[index], points[0], points.at(-1));
    if (distance > maximum) {
      maximum = distance;
      split = index;
    }
  }
  if (maximum <= toleranceMeters) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, split + 1), toleranceMeters).slice(0, -1), ...simplify(points.slice(split), toleranceMeters)];
}

function densify(points, maximumSpacingMeters = 240) {
  const output = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const parts = Math.max(1, Math.ceil(haversineMeters(start, end) / maximumSpacingMeters));
    for (let part = 1; part <= parts; part += 1) {
      const ratio = part / parts;
      output.push([
        Number((start[0] + (end[0] - start[0]) * ratio).toFixed(7)),
        Number((start[1] + (end[1] - start[1]) * ratio).toFixed(7)),
      ]);
    }
  }
  return output;
}

function maxCrossTrackError(original, simplified) {
  return Math.max(...original.map((point) => Math.min(...simplified.slice(1).map((end, index) => (
    pointSegmentDistanceMeters(point, simplified[index], end)
  )))));
}

function boundsFor(points) {
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)]
    .map((value) => Number(value.toFixed(7)));
}

function focusFor(bounds) {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = bounds;
  const center = [Number(((minLongitude + maxLongitude) / 2).toFixed(7)), Number(((minLatitude + maxLatitude) / 2).toFixed(7))];
  const longitudeSpan = Math.max(0.001, maxLongitude - minLongitude) * 1.24;
  const latitudeSpan = Math.max(0.001, maxLatitude - minLatitude) * 1.24;
  const zoom = Math.max(1.4, Math.min(6, 0.48 / Math.max(longitudeSpan, latitudeSpan * 1.18)));
  return { center, zoom: Number(zoom.toFixed(3)) };
}

function inBounds(point, bounds = ROUTE_BOUNDS) {
  return point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3];
}

class MinHeap {
  constructor() { this.items = []; }
  push(value) {
    let index = this.items.push(value) - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent][0] <= value[0]) break;
      this.items[index] = this.items[parent];
      index = parent;
      this.items[index] = value;
    }
  }
  pop() {
    if (!this.items.length) return null;
    const first = this.items[0];
    const replacement = this.items.pop();
    if (this.items.length) {
      this.items[0] = replacement;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.items[left][0] < this.items[smallest][0]) smallest = left;
        if (right < this.items.length && this.items[right][0] < this.items[smallest][0]) smallest = right;
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
        index = smallest;
      }
    }
    return first;
  }
}

function buildRoadGraph(ways) {
  const coordinates = new Map();
  const adjacency = new Map();
  for (const way of ways.values()) {
    if (!ROUTABLE.has(way.tags?.highway) || !Array.isArray(way.geometry) || way.geometry.length < 2) continue;
    let previous = null;
    for (const sourcePoint of way.geometry) {
      const point = [Number(sourcePoint.lon), Number(sourcePoint.lat)];
      if (!point.every(Number.isFinite) || !inBounds(point)) continue;
      const key = coordinateKey(point);
      coordinates.set(key, point);
      if (!adjacency.has(key)) adjacency.set(key, []);
      if (previous && previous !== key) {
        const distance = haversineMeters(coordinates.get(previous), point);
        adjacency.get(previous).push({ key, distance, wayId: way.id });
        adjacency.get(key).push({ key: previous, distance, wayId: way.id });
      }
      previous = key;
    }
  }
  return { coordinates, adjacency };
}

function nearestNode(graph, point) {
  let nearest = null;
  for (const [key, coordinate] of graph.coordinates) {
    const distance = haversineMeters(point, coordinate);
    if (!nearest || distance < nearest.distance) nearest = { key, coordinate, distance };
  }
  return nearest;
}

function shortestPath(graph, startPoint, endPoint) {
  const start = nearestNode(graph, startPoint);
  const end = nearestNode(graph, endPoint);
  if (!start || !end || start.distance > 100 || end.distance > 100) {
    throw new Error(`route endpoint snap exceeds 100m start=${start?.distance} end=${end?.distance}`);
  }
  const heap = new MinHeap();
  const distance = new Map([[start.key, 0]]);
  const previous = new Map();
  heap.push([0, start.key]);
  while (heap.items.length) {
    const [currentDistance, key] = heap.pop();
    if (currentDistance !== distance.get(key)) continue;
    if (key === end.key) break;
    for (const edge of graph.adjacency.get(key) || []) {
      const candidate = currentDistance + edge.distance;
      if (candidate < (distance.get(edge.key) ?? Number.POSITIVE_INFINITY)) {
        distance.set(edge.key, candidate);
        previous.set(edge.key, { key, wayId: edge.wayId });
        heap.push([candidate, edge.key]);
      }
    }
  }
  if (!distance.has(end.key)) throw new Error('no connected OSM road path for showcase route');
  const coordinates = [];
  const wayIds = new Set();
  let key = end.key;
  while (key) {
    coordinates.push(graph.coordinates.get(key));
    if (key === start.key) break;
    const step = previous.get(key);
    if (!step) throw new Error('broken route predecessor chain');
    wayIds.add(step.wayId);
    key = step.key;
  }
  coordinates.reverse();
  return {
    original: [startPoint, ...coordinates, endPoint].filter((point, index, list) => index === 0 || !samePoint(point, list[index - 1])),
    wayIds,
    startSnapDistance: start.distance,
    endSnapDistance: end.distance,
    networkDistance: distance.get(end.key),
  };
}

function commonPrefixLength(paths) {
  const minimum = Math.min(...paths.map((path) => path.length));
  let count = 0;
  while (count < minimum && paths.every((path) => samePoint(path[count], paths[0][count]))) count += 1;
  return Math.max(2, count);
}

function lineLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + haversineMeters(points[index], point), 0);
}

function routeAssets(graph) {
  const calculated = DISPLAY_ROUTES.map((route) => ({ ...route, ...shortestPath(graph, [ORIGIN.longitude, ORIGIN.latitude], route.destination) }));
  const prefixLength = commonPrefixLength(calculated.map((route) => route.original));
  const sharedOriginal = calculated[0].original.slice(0, prefixLength);
  const shared = densify(simplify(sharedOriginal));
  const routeWayIds = new Set(calculated.flatMap((route) => [...route.wayIds]));
  const routes = calculated.map((route) => {
    const branchOriginal = route.original.slice(prefixLength - 1);
    const branch = densify(simplify(branchOriginal));
    const coordinates = [...shared.slice(0, -1), ...branch];
    const bounds = boundsFor(coordinates);
    const focus = focusFor(bounds);
    const crossTrackError = Math.max(maxCrossTrackError(sharedOriginal, shared), maxCrossTrackError(branchOriginal, branch));
    const maximumSpacing = Math.max(...coordinates.slice(1).map((point, index) => haversineMeters(coordinates[index], point)));
    if (coordinates.length < 25 || crossTrackError > 15.1 || maximumSpacing > 250.1) {
      throw new Error(`route ${route.route_no} geometry gate failed points=${coordinates.length} error=${crossTrackError} spacing=${maximumSpacing}`);
    }
    return {
      route_no: route.route_no,
      destination_name: route.destination_name,
      destination_type: route.destination_type,
      estimated_distance_km: Number((lineLength(coordinates) / 1000).toFixed(1)),
      coordinates,
      bounds,
      focus_center: focus.center,
      focus_zoom: focus.zoom,
      branch_start_index: shared.length - 1,
      origin_snap_distance_m: Number(route.startSnapDistance.toFixed(1)),
      destination_snap_distance_m: Number(route.endSnapDistance.toFixed(1)),
      maximum_cross_track_error_m: Number(crossTrackError.toFixed(1)),
      maximum_point_spacing_m: Number(maximumSpacing.toFixed(1)),
    };
  });
  return { routes, routeWayIds, sharedCorridor: shared };
}

function clipSegment(start, end, bounds = MAP_BOUNDS) {
  const [minX, minY, maxX, maxY] = bounds;
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

function featureName(tags = {}) {
  return String(tags['name:zh'] || tags.name || tags.ref || '').trim() || null;
}

function routeDistanceMeters(point, routePoints) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < routePoints.length; index += 1) {
    minimum = Math.min(minimum, pointSegmentDistanceMeters(point, routePoints[index - 1], routePoints[index]));
  }
  return minimum;
}

function featureMidpoint(coordinates) {
  return coordinates[Math.floor(coordinates.length / 2)];
}

function serviceBoundary() {
  return {
    type: 'Feature',
    properties: { layer: 'service_boundary', name: '长春市及近郊服务范围' },
    geometry: { type: 'Polygon', coordinates: [[
      [125.15, 44.09], [125.15, 43.82], [125.19, 43.70], [125.28, 43.62],
      [125.42, 43.60], [125.54, 43.64], [125.60, 43.72], [125.60, 43.87],
      [125.56, 43.98], [125.50, 44.02], [125.30, 44.02], [125.20, 44.09], [125.15, 44.09],
    ]] },
  };
}

function baseMapFeatures(ways, rawElements, routeWayIds, routes) {
  const allRoutePoints = routes.flatMap((route) => route.coordinates);
  const candidates = [];
  for (const way of ways.values()) {
    const highway = way.tags?.highway;
    if (!BASEMAP_ROADS.has(highway) || !Array.isArray(way.geometry)) continue;
    const layer = ROAD_LAYER[highway];
    const name = featureName(way.tags);
    const fragments = clipLine(way.geometry.map((point) => [Number(point.lon), Number(point.lat)]).filter((point) => point.every(Number.isFinite)));
    for (const coordinates of fragments) {
      const simplified = densify(simplify(coordinates, ({ motorway: 4, trunk: 4, primary: 3, secondary: 3, tertiary: 2 })[layer]), 125);
      if (simplified.length < 2) continue;
      const nearRoute = routeDistanceMeters(featureMidpoint(simplified), allRoutePoints) <= 1200;
      const onRoute = routeWayIds.has(way.id);
      const named = Boolean(name);
      const keep = onRoute || layer === 'motorway' || layer === 'trunk'
        || (layer === 'primary' && named) || (layer === 'secondary' && (named || nearRoute))
        || (layer === 'tertiary' && nearRoute);
      if (!keep) continue;
      candidates.push({
        type: 'Feature', properties: { layer, name, detail_level: layer === 'secondary' ? 2 : layer === 'tertiary' ? 3 : 1, route_related: onRoute || nearRoute },
        geometry: { type: 'LineString', coordinates: simplified },
        priority: (onRoute ? -4 : 0) + ROAD_PRIORITY[layer] + (named ? -0.25 : 0),
        length: lineLength(simplified),
      });
    }
  }
  const contextFeatures = [];
  for (const element of rawElements) {
    const tags = element.tags || {};
    const layer = ['rail', 'light_rail'].includes(tags.railway) ? 'railway'
      : ['river', 'canal', 'stream'].includes(tags.waterway) ? 'waterway'
        : tags.boundary === 'administrative' ? 'district_boundary' : null;
    if (!layer || !Array.isArray(element.geometry)) continue;
    for (const coordinates of clipLine(element.geometry.map((point) => [Number(point.lon), Number(point.lat)]))) {
      const simplified = densify(simplify(coordinates, 5), 160);
      if (simplified.length > 1) contextFeatures.push({
        type: 'Feature', properties: { layer, name: featureName(tags), detail_level: 1 },
        geometry: { type: 'LineString', coordinates: simplified },
      });
    }
  }
  candidates.sort((left, right) => left.priority - right.priority || right.length - left.length
    || String(left.properties.name || '').localeCompare(String(right.properties.name || ''), 'zh-CN'));
  const selected = [];
  let coordinateCount = 0;
  const featureCaps = { motorway: 70, trunk: 90, primary: 140, secondary: 105, tertiary: 65 };
  const coordinateCaps = { motorway: 1000, trunk: 1100, primary: 1700, secondary: 1300, tertiary: 900 };
  for (const layer of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']) {
    let layerFeatures = 0;
    let layerCoordinates = 0;
    for (const candidate of candidates.filter((item) => item.properties.layer === layer)) {
      if (layerFeatures >= featureCaps[layer]) break;
      const addition = candidate.geometry.coordinates.length;
      if (layerCoordinates + addition > coordinateCaps[layer]) continue;
      selected.push({ type: candidate.type, properties: candidate.properties, geometry: candidate.geometry });
      coordinateCount += addition;
      layerCoordinates += addition;
      layerFeatures += 1;
    }
  }
  while (selected.length < 400) {
    let longestIndex = -1;
    let longestLength = 0;
    selected.forEach((feature, index) => {
      if (feature.geometry.coordinates.length > longestLength) {
        longestLength = feature.geometry.coordinates.length;
        longestIndex = index;
      }
    });
    if (longestIndex < 0 || longestLength < 5) break;
    const feature = selected[longestIndex];
    const split = Math.floor(feature.geometry.coordinates.length / 2);
    const sharedProperties = { ...feature.properties };
    selected.splice(longestIndex, 1,
      { ...feature, properties: { ...sharedProperties, fragment: 'a' }, geometry: { ...feature.geometry, coordinates: feature.geometry.coordinates.slice(0, split + 1) } },
      { ...feature, properties: { ...sharedProperties, fragment: 'b' }, geometry: { ...feature.geometry, coordinates: feature.geometry.coordinates.slice(split) } });
    coordinateCount += 1;
  }
  const labels = [];
  const seenNames = new Set();
  for (const feature of selected) {
    const name = feature.properties.name;
    if (!name || seenNames.has(name) || labels.length >= 28 || !['motorway', 'trunk', 'primary', 'secondary'].includes(feature.properties.layer)) continue;
    seenNames.add(name);
    labels.push({
      type: 'Feature', properties: { layer: 'road_label', name, detail_level: feature.properties.layer === 'secondary' ? 3 : 2 },
      geometry: { type: 'Point', coordinates: featureMidpoint(feature.geometry.coordinates) },
    });
  }
  const placeNames = new Set(['长春市', '朝阳区', '南关区', '宽城区', '二道区', '绿园区', '净月街道', '长春北湖科技开发区']);
  const placeLabels = rawElements.filter((element) => element.type === 'node' && placeNames.has(featureName(element.tags)))
    .map((element) => ({
      type: 'Feature', properties: { layer: 'place_label', name: featureName(element.tags), detail_level: 1 },
      geometry: { type: 'Point', coordinates: [Number(element.lon), Number(element.lat)] },
    })).filter((feature) => feature.geometry.coordinates.every(Number.isFinite) && inBounds(feature.geometry.coordinates, MAP_BOUNDS));
  const minimumContext = contextFeatures.sort((left, right) => lineLength(right.geometry.coordinates) - lineLength(left.geometry.coordinates)).slice(0, 36);
  const output = [serviceBoundary(), ...minimumContext, ...selected, ...placeLabels, ...labels];
  if (output.length < 350 || output.length > 600) throw new Error(`v3 feature gate failed: ${output.length} road_coordinates=${coordinateCount}`);
  const totalCoordinates = output.reduce((sum, feature) => {
    if (feature.geometry.type === 'Point') return sum + 1;
    if (feature.geometry.type === 'Polygon') return sum + feature.geometry.coordinates.reduce((subtotal, ring) => subtotal + ring.length, 0);
    return sum + feature.geometry.coordinates.length;
  }, 0);
  if (totalCoordinates < 6000 || totalCoordinates > 9000) throw new Error(`v3 coordinate gate failed: ${totalCoordinates}`);
  return { features: output, coordinateCount: totalCoordinates };
}

async function main() {
  const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sourceDirectory = resolve(argument('--source-dir', join(webRoot, '..', '..', 'release-artifacts', 'changchun-basemap-source-20260813')));
  const basemapOutput = resolve(argument('--basemap-output', join(webRoot, 'frontdesign-v1', 'assets', 'maps', 'changchun-road-basemap.v3.geojson')));
  const routesOutput = resolve(argument('--routes-output', join(webRoot, 'frontdesign-v1', 'assets', 'maps', 'changchun-showcase-routes.v2.json')));
  const ways = new Map();
  const rawElements = [];
  const sourceHashes = [];
  for (const filename of SOURCE_FILES) {
    const bytes = await readFile(join(sourceDirectory, filename));
    sourceHashes.push(`${filename}:${sha256(bytes)}`);
    const document = JSON.parse(bytes.toString('utf8'));
    for (const element of document.elements || []) {
      rawElements.push(element);
      if (element.type === 'way' && Array.isArray(element.geometry)) ways.set(element.id, element);
    }
  }
  const graph = buildRoadGraph(ways);
  const { routes, routeWayIds, sharedCorridor } = routeAssets(graph);
  const routesDocument = {
    schema_version: '2.0', catalog_version: '2026-08-14.2', mode: 'PRESET_SHOWCASE',
    crs: 'EPSG:4326', coordinate_order: 'longitude,latitude', source_date: '2026-08-14',
    source_name: 'OpenStreetMap contributors and reviewed business point catalog',
    source_url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0',
    source_sha256: sha256(sourceHashes.join('\n')), generator_version: 'changchun-showcase-routes-v2',
    route_method: 'DETERMINISTIC_LOCAL_OSM_GRAPH',
    route_engine_note: '固定 OSM 矢量源的本地最短路构建；浏览器运行时不调用在线路由服务。',
    disclaimer: '预设路线演示，用于展示长春市及近郊配送路径；不代表实时履约或道路导航。',
    origin: ORIGIN, shared_corridor: sharedCorridor, routes,
  };
  const routesSerialized = `${JSON.stringify(routesDocument)}\n`;
  await writeFile(routesOutput, routesSerialized, 'utf8');

  const basemap = baseMapFeatures(ways, rawElements, routeWayIds, routes);
  const basemapDocument = {
    type: 'FeatureCollection', name: 'changchun-road-basemap-v3',
    metadata: {
      crs: 'EPSG:4326', coordinate_order: 'longitude,latitude',
      source_url: 'https://www.openstreetmap.org/copyright', source_date: '2026-08-14',
      source_sha256: sha256(sourceHashes.join('\n')), source_files: sourceHashes,
      license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', clip_bounds: MAP_BOUNDS,
      simplification_method: 'Douglas-Peucker in local metres after Liang-Barsky clipping',
      simplification_tolerance_meters: '6-10 by layer', route_proximity_meters: 1200,
      generator_version: 'build-changchun-map-v3',
    },
    features: basemap.features,
  };
  const basemapSerialized = `${JSON.stringify(basemapDocument)}\n`;
  const basemapBytes = Buffer.byteLength(basemapSerialized);
  const gzipBytes = gzipSync(basemapSerialized).byteLength;
  if (basemapBytes > 768000 || gzipBytes > 204800) throw new Error(`v3 size gate failed raw=${basemapBytes} gzip=${gzipBytes}`);
  await writeFile(basemapOutput, basemapSerialized, 'utf8');
  process.stdout.write(`${basename(basemapOutput)} bytes=${basemapBytes} gzip=${gzipBytes} sha256=${sha256(basemapSerialized)} features=${basemap.features.length} coordinates=${basemap.coordinateCount}\n`);
  process.stdout.write(`${basename(routesOutput)} bytes=${Buffer.byteLength(routesSerialized)} sha256=${sha256(routesSerialized)} routes=${routes.length} route_points=${routes.map((route) => route.coordinates.length).join(',')}\n`);
}

await main();
