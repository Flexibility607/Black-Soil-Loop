import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mapsRoot = join(webRoot, 'frontdesign-v1', 'assets', 'maps');
const routesV2Path = join(mapsRoot, 'changchun-showcase-routes.v2.json');
const basemapV3Path = join(mapsRoot, 'changchun-road-basemap.v3.geojson');
const routesV3Path = join(mapsRoot, 'changchun-showcase-routes.v3.json');
const basemapV4Path = join(mapsRoot, 'changchun-road-basemap.v4.geojson');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function samePoint(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && Math.abs(Number(left[0]) - Number(right[0])) < 1e-7
    && Math.abs(Number(left[1]) - Number(right[1])) < 1e-7;
}

function pointKey(point) {
  return `${Number(point[0]).toFixed(7)},${Number(point[1]).toFixed(7)}`;
}

function edgeKey(left, right) {
  const start = pointKey(left);
  const end = pointKey(right);
  return start < end ? `${start}|${end}` : `${end}|${start}`;
}

function haversineMeters(left, right) {
  const radians = (value) => value * Math.PI / 180;
  const latitude1 = radians(Number(left[1]));
  const latitude2 = radians(Number(right[1]));
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = radians(Number(right[0]) - Number(left[0]));
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function lineLength(coordinates) {
  return coordinates.slice(1).reduce((sum, point, index) => sum + haversineMeters(coordinates[index], point), 0);
}

function boundsFor(coordinates) {
  const longitudes = coordinates.map((point) => Number(point[0]));
  const latitudes = coordinates.map((point) => Number(point[1]));
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)]
    .map((value) => Number(value.toFixed(7)));
}

function focusFor(bounds, scope) {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = bounds;
  const longitudeSpan = Math.max(0.002, maxLongitude - minLongitude);
  const latitudeSpan = Math.max(0.002, maxLatitude - minLatitude);
  const targetLongitude = scope === 'DETAIL' ? 0.24 : 0.39;
  const targetLatitude = scope === 'DETAIL' ? 0.27 : 0.42;
  const minimum = scope === 'DETAIL' ? 1.55 : 1;
  return {
    center: [
      Number(((minLongitude + maxLongitude) / 2).toFixed(7)),
      Number(((minLatitude + maxLatitude) / 2).toFixed(7)),
    ],
    zoom: Number(Math.max(minimum, Math.min(6, targetLongitude / longitudeSpan, targetLatitude / latitudeSpan)).toFixed(3)),
  };
}

function orientedCorridor(corridor, previousPoint) {
  if (!previousPoint || samePoint(previousPoint, corridor.coordinates[0])) return corridor.coordinates;
  if (samePoint(previousPoint, corridor.coordinates.at(-1))) return [...corridor.coordinates].reverse();
  throw new Error(`corridor ${corridor.corridor_key} is not continuous`);
}

function reconstruct(corridorKeys, corridorByKey) {
  const coordinates = [];
  for (const key of corridorKeys) {
    const corridor = corridorByKey.get(key);
    if (!corridor) throw new Error(`missing corridor ${key}`);
    const oriented = orientedCorridor(corridor, coordinates.at(-1));
    coordinates.push(...(coordinates.length ? oriented.slice(1) : oriented));
  }
  return coordinates;
}

function corridorize(document) {
  const memberships = new Map();
  for (const route of document.routes) {
    for (let index = 1; index < route.coordinates.length; index += 1) {
      const key = edgeKey(route.coordinates[index - 1], route.coordinates[index]);
      if (!memberships.has(key)) memberships.set(key, new Set());
      memberships.get(key).add(route.route_no);
    }
  }

  const corridors = [];
  const edgeToCorridor = new Map();
  let corridorNumber = 0;
  for (const route of document.routes) {
    let index = 0;
    while (index < route.coordinates.length - 1) {
      const firstEdge = edgeKey(route.coordinates[index], route.coordinates[index + 1]);
      if (edgeToCorridor.has(firstEdge)) {
        index += 1;
        continue;
      }
      const routeNos = [...memberships.get(firstEdge)].sort();
      const membership = routeNos.join('.');
      const entrance = index === 0 && samePoint(route.coordinates[0], [document.origin.longitude, document.origin.latitude]);
      let end = index + 1;
      let corridorLength = haversineMeters(route.coordinates[index], route.coordinates[end]);
      if (!entrance) {
        while (end < route.coordinates.length - 1) {
          const nextEdge = edgeKey(route.coordinates[end], route.coordinates[end + 1]);
          const nextMembership = [...memberships.get(nextEdge)].sort().join('.');
          if (edgeToCorridor.has(nextEdge) || nextMembership !== membership || corridorLength >= 12000) break;
          corridorLength += haversineMeters(route.coordinates[end], route.coordinates[end + 1]);
          end += 1;
        }
      }
      const coordinates = route.coordinates.slice(index, end + 1);
      const corridorKey = `corridor-${String(++corridorNumber).padStart(3, '0')}`;
      const kind = entrance ? 'ENTRANCE' : routeNos.length > 1 ? 'SHARED' : 'EXCLUSIVE';
      const corridor = {
        corridor_key: corridorKey,
        route_nos: routeNos,
        kind,
        coordinates,
        distance_km: Number((lineLength(coordinates) / 1000).toFixed(3)),
      };
      corridors.push(corridor);
      for (let edgeIndex = index; edgeIndex < end; edgeIndex += 1) {
        edgeToCorridor.set(edgeKey(route.coordinates[edgeIndex], route.coordinates[edgeIndex + 1]), corridorKey);
      }
      index = end;
    }
  }

  const corridorByKey = new Map(corridors.map((corridor) => [corridor.corridor_key, corridor]));
  const routes = document.routes.map((sourceRoute) => {
    const corridorKeys = [];
    for (let index = 1; index < sourceRoute.coordinates.length; index += 1) {
      const corridorKey = edgeToCorridor.get(edgeKey(sourceRoute.coordinates[index - 1], sourceRoute.coordinates[index]));
      if (!corridorKey) throw new Error(`route ${sourceRoute.route_no} has an unassigned edge`);
      if (corridorKeys.at(-1) !== corridorKey) corridorKeys.push(corridorKey);
    }
    const rebuilt = reconstruct(corridorKeys, corridorByKey);
    if (!samePoint(rebuilt[0], sourceRoute.coordinates[0]) || !samePoint(rebuilt.at(-1), sourceRoute.coordinates.at(-1))) {
      throw new Error(`route ${sourceRoute.route_no} endpoints changed during corridor reconstruction`);
    }
    const sourceLength = lineLength(sourceRoute.coordinates);
    const rebuiltLength = lineLength(rebuilt);
    if (Math.abs(sourceLength - rebuiltLength) / sourceLength > 0.01) throw new Error(`route ${sourceRoute.route_no} length changed by more than 1%`);

    const detailKeys = [];
    let detailLength = 0;
    for (let index = corridorKeys.length - 1; index >= 0; index -= 1) {
      const corridor = corridorByKey.get(corridorKeys[index]);
      if (corridor.kind === 'ENTRANCE') continue;
      detailKeys.unshift(corridor.corridor_key);
      detailLength += lineLength(corridor.coordinates);
      if (detailLength >= 10000) break;
    }
    const detailCoordinates = reconstruct(detailKeys, corridorByKey);
    const fullBounds = boundsFor(rebuilt);
    const detailBounds = boundsFor(detailCoordinates);
    return {
      route_no: sourceRoute.route_no,
      destination_name: sourceRoute.destination_name,
      destination_type: sourceRoute.destination_type,
      corridor_keys: corridorKeys,
      detail_corridor_keys: detailKeys,
      full_bounds: fullBounds,
      full_focus: focusFor(fullBounds, 'FULL'),
      detail_bounds: detailBounds,
      detail_focus: focusFor(detailBounds, 'DETAIL'),
      full_distance_km: Number((rebuiltLength / 1000).toFixed(1)),
      detail_distance_km: Number((lineLength(detailCoordinates) / 1000).toFixed(1)),
      origin_snap_distance_m: sourceRoute.origin_snap_distance_m,
      destination_snap_distance_m: sourceRoute.destination_snap_distance_m,
    };
  });
  return { corridors, routes, corridorByKey };
}

function basemapV4(document, corridors, sourceHashes) {
  const serviceBoundary = document.features.find((feature) => feature.properties?.layer === 'service_boundary');
  const districtBoundary = serviceBoundary ? {
    type: 'Feature',
    properties: { layer: 'district_boundary', name: '长春市及近郊服务区划边界', detail_level: 1 },
    geometry: { type: 'LineString', coordinates: serviceBoundary.geometry.coordinates[0] },
  } : null;
  const connectorFeatures = corridors.map((corridor) => ({
    type: 'Feature',
    properties: {
      layer: 'route_connector',
      name: corridor.kind === 'ENTRANCE' ? '园区入口连接线' : '配送路线连接道路',
      detail_level: corridor.kind === 'ENTRANCE' ? 2 : 3,
      route_nos: corridor.route_nos,
    },
    geometry: { type: 'LineString', coordinates: corridor.coordinates },
  }));
  const features = [...document.features, ...(districtBoundary ? [districtBoundary] : []), ...connectorFeatures];
  const metadata = {
    ...document.metadata,
    source_sha256: sha256(sourceHashes.join('\n')),
    generator_version: 'build-changchun-route-corridors-v4',
    route_connector_source: 'frozen showcase route corridor network derived from fixed OSM vector source',
  };
  return { ...document, name: 'changchun-road-basemap-v4', metadata, features };
}

async function main() {
  const [routesV2Bytes, basemapV3Bytes] = await Promise.all([readFile(routesV2Path), readFile(basemapV3Path)]);
  const routesV2 = JSON.parse(routesV2Bytes.toString('utf8'));
  const basemapV3 = JSON.parse(basemapV3Bytes.toString('utf8'));
  const { corridors, routes } = corridorize(routesV2);
  const routesV3 = {
    schema_version: '3.0',
    catalog_version: '2026-08-14.3',
    mode: 'PRESET_SHOWCASE',
    crs: 'EPSG:4326',
    coordinate_order: 'longitude,latitude',
    source_date: '2026-08-14',
    source_name: routesV2.source_name,
    source_url: routesV2.source_url,
    license: routesV2.license,
    source_sha256: sha256(routesV2Bytes),
    generator_version: 'changchun-showcase-route-corridors-v3',
    route_method: routesV2.route_method,
    route_engine_note: routesV2.route_engine_note,
    disclaimer: routesV2.disclaimer,
    origin: routesV2.origin,
    corridors,
    routes,
  };
  const routesV3Serialized = `${JSON.stringify(routesV3)}\n`;
  const sourceHashes = [`${routesV2Path.split(/[\\/]/).at(-1)}:${sha256(routesV2Bytes)}`, `${basemapV3Path.split(/[\\/]/).at(-1)}:${sha256(basemapV3Bytes)}`];
  const basemap = basemapV4(basemapV3, corridors, sourceHashes);
  const basemapSerialized = `${JSON.stringify(basemap)}\n`;
  const coordinateCount = basemap.features.reduce((sum, feature) => {
    if (feature.geometry.type === 'Point') return sum + 1;
    if (feature.geometry.type === 'Polygon') return sum + feature.geometry.coordinates.flat(1).length;
    if (feature.geometry.type === 'MultiLineString') return sum + feature.geometry.coordinates.flat(1).length;
    return sum + feature.geometry.coordinates.length;
  }, 0);
  if (basemap.features.length < 450 || basemap.features.length > 650) throw new Error(`v4 feature gate failed: ${basemap.features.length}`);
  if (coordinateCount > 10000) throw new Error(`v4 coordinate gate failed: ${coordinateCount}`);
  if (!basemap.features.some((feature) => feature.properties.layer === 'district_boundary')) throw new Error('v4 district boundary missing');
  if (!basemap.features.some((feature) => ['water', 'waterway'].includes(feature.properties.layer))) throw new Error('v4 water context missing');
  if (!basemap.features.some((feature) => feature.properties.layer === 'route_connector')) throw new Error('v4 route connectors missing');
  const routeHashes = new Set(corridors.map((corridor) => sha256(JSON.stringify(corridor.coordinates))));
  if (routeHashes.size !== corridors.length) throw new Error('duplicate corridor geometry detected');
  await Promise.all([
    writeFile(routesV3Path, routesV3Serialized, 'utf8'),
    writeFile(basemapV4Path, basemapSerialized, 'utf8'),
  ]);
  process.stdout.write(`${routesV3Path}\n  corridors=${corridors.length} bytes=${Buffer.byteLength(routesV3Serialized)} sha256=${sha256(routesV3Serialized)}\n`);
  process.stdout.write(`${basemapV4Path}\n  features=${basemap.features.length} coordinates=${coordinateCount} bytes=${Buffer.byteLength(basemapSerialized)} gzip=${gzipSync(basemapSerialized).byteLength} sha256=${sha256(basemapSerialized)}\n`);
}

await main();
