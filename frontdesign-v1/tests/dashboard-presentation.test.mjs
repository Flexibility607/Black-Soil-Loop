import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildChangchunMapOption,
  basemapVisibilityPatch,
  localGeoJsonIsChangchunRoadBasemap,
  localGeoJsonIsChangchunServiceArea,
  localShowcaseRoutesAreValid,
  normalizeMapViewport,
  overviewMapViewport,
  reconstructShowcaseRoute,
  routeFocusViewport,
  selectChangchunRoutes,
} from '../dashboard-map.js';
import { SCREEN_PALETTES } from '../dashboard-format.js';

const projectRoot = new URL('../../', import.meta.url);

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

test('长春服务范围 GeoJSON 只包含有效面几何并进入本地构建', async () => {
  const source = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-service-area.geojson', projectRoot), 'utf8'));
  assert.equal(localGeoJsonIsChangchunServiceArea(source), true);
  assert.ok(source.features.length > 0);
  assert.match(JSON.stringify(source), /EPSG:4326/);
});

test('长春道路底图 v4 固定为首方 ODbL 矢量资产并补齐路线连接道路', async () => {
  const bytes = await readFile(new URL('frontdesign-v1/assets/maps/changchun-road-basemap.v4.geojson', projectRoot));
  const source = JSON.parse(bytes.toString('utf8'));
  assert.equal(localGeoJsonIsChangchunRoadBasemap(source), true);
  assert.equal(source.metadata.crs, 'EPSG:4326');
  assert.equal(source.metadata.coordinate_order, 'longitude,latitude');
  assert.equal(source.metadata.license, 'ODbL 1.0');
  assert.deepEqual(source.metadata.clip_bounds, [125.15, 43.6, 125.6, 44.1]);
  assert.ok(source.features.length >= 450 && source.features.length <= 650);
  assert.ok(bytes.length <= 750 * 1024);
  const coordinateCount = source.features.reduce((sum, feature) => {
    if (feature.geometry.type === 'Point') return sum + 1;
    if (feature.geometry.type === 'Polygon') return sum + feature.geometry.coordinates.flat(1).length;
    if (feature.geometry.type === 'MultiLineString') return sum + feature.geometry.coordinates.flat(1).length;
    return sum + feature.geometry.coordinates.length;
  }, 0);
  assert.ok(coordinateCount >= 6000 && coordinateCount <= 10000);
  const layers = new Set(source.features.map((feature) => feature.properties.layer));
  for (const layer of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'railway', 'waterway', 'district_boundary', 'route_connector', 'place_label', 'road_label']) assert.ok(layers.has(layer));
});

test('长春地图每个活动任务只有一条线路且报警只形成红色光圈', () => {
  const snapshot = {
    public_map: {
      points: [{ display_name: '这有山', point_type: 'THIRD_SPACE', longitude: 125.3, latitude: 43.8 }],
      active_routes: [{
        route_key: 'safe-route-key', status: 'IN_TRANSIT', status_label: '运输中', vehicle_label: '吉A·12***',
        from: { kind: 'VEHICLE', longitude: 125.31, latitude: 43.81 },
        to: { display_name: '净月潭', channel: 'THIRD_SPACE', longitude: 125.45, latitude: 43.78 },
        latest_location: { freshness: 'FRESH', recorded_at: '2026-08-13T09:00:00+08:00' },
        alerts: [{ message: '温度超限' }], alert_count: 1,
      }],
    },
  };
  const option = buildChangchunMapOption(snapshot, SCREEN_PALETTES.night);
  assert.equal(option.geo.map, 'changchun-service-area');
  assert.equal(option.series.find((item) => item.name === '配送展示路线').data.length, 1);
  assert.equal(option.series.find((item) => item.name === '独立温湿度报警').data.length, 1);
  assert.notEqual(option.series.find((item) => item.name === '配送展示路线').data[0].lineStyle.color, SCREEN_PALETTES.night.danger);
});

test('长春道路、标签与业务覆盖层共用可缩放 geo 坐标系', async () => {
  const basemap = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-road-basemap.v4.geojson', projectRoot), 'utf8'));
  const option = buildChangchunMapOption({ public_map: { points: [], active_routes: [] } }, SCREEN_PALETTES.day, basemap);
  assert.equal(option.geo.roam, true);
  assert.deepEqual(option.geo.scaleLimit, { min: 1, max: 8 });
  assert.equal(option.geo.zoom, 1);
  assert.ok(option.series.some((series) => series.name === '高速与快速路' && series.silent === true));
  assert.ok(option.series.some((series) => series.name === '主要水系' && series.silent === true));
  assert.ok(option.series.some((series) => series.name === '铁路' && series.silent === true));
  assert.ok(option.series.some((series) => series.name === '长春片区标签' && series.silent === true));
  assert.ok(option.series.some((series) => series.name === '主要道路名称' && series.silent === true));
  for (const series of option.series) assert.equal(series.coordinateSystem, 'geo');
  for (const series of option.series.filter((item) => item.type === 'lines')) assert.equal(series.polyline, true);
});

test('地图视域按上下限归一化且路线聚焦使用冻结目录参数', async () => {
  const basemap = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-road-basemap.v4.geojson', projectRoot), 'utf8'));
  const catalog = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-showcase-routes.v3.json', projectRoot), 'utf8'));
  const overview = overviewMapViewport(basemap);
  assert.deepEqual(overview, { mode: 'OVERVIEW', center: [125.375, 43.85], zoom: 1, selectedRouteKey: null, focusScope: 'DETAIL' });
  assert.equal(normalizeMapViewport({ zoom: 99 }).zoom, 8);
  assert.equal(normalizeMapViewport({ zoom: 0.1 }).zoom, 1);
  const presentation = selectChangchunRoutes({ public_map: { active_routes: [] } }, catalog);
  const focused = routeFocusViewport(presentation.routes[0]);
  assert.equal(focused.mode, 'ROUTE_DETAIL');
  assert.deepEqual(focused.center, catalog.routes[0].detail_focus.center);
  assert.equal(focused.zoom, catalog.routes[0].detail_focus.zoom);
  assert.equal(focused.selectedRouteKey, 'showcase-01');
  assert.equal(routeFocusViewport(presentation.routes[0], 'FULL').mode, 'ROUTE_FULL');
  assert.equal(basemapVisibilityPatch(1)[0].lineStyle.opacity, 0);
  assert.equal(basemapVisibilityPatch(1.6)[0].lineStyle.opacity, 1);
  assert.equal(basemapVisibilityPatch(2.6)[1].lineStyle.opacity, 0.72);
});

test('地图缩放控件和增量更新保留用户视域且不触发地图网络请求', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  for (const id of ['dv2-map-zoom-in', 'dv2-map-zoom-out', 'dv2-map-overview', 'dv2-map-zoom-status']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /支持滚轮缩放和鼠标拖动/);
  assert.match(dashboard, /chart\.on\('georoam', onMapGeoRoam\)/);
  assert.doesNotMatch(dashboard, /replaceMerge:\s*\['series'\]/);
  assert.match(dashboard, /state\.mapViewport\.zoom \* 1\.25/);
  assert.match(dashboard, /state\.mapViewport\.zoom \/ 1\.25/);
  assert.match(dashboard, /overviewMapViewport\(state\.mapBasemap\)/);
  const roamHandler = dashboard.match(/function onMapGeoRoam\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(roamHandler, /fetch\(|API\./);
});

test('E02 同屏展示资讯双栏与四类协同方案并使用无认证公开请求', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  for (const marker of ['dv2-information-news', 'dv2-information-policy', 'dv2-showcase-content', 'dv2-algorithm-dialog']) assert.match(html, new RegExp(marker));
  for (const marker of ['dv2-ranking-loop-toggle', 'dv2-information-loop-toggle', 'dv2-showcase-summary']) assert.match(html, new RegExp(marker));
  for (const kind of ['CARPOOL', 'WAREHOUSE', 'PROCUREMENT', 'FORECAST']) assert.match(html, new RegExp(`data-kind="${kind}"`));
  assert.match(api, /getPublicInformation[\s\S]*authPolicy: 'omit'[\s\S]*credentialsPolicy: 'omit'/);
  assert.match(api, /getDashboardSnapshot[\s\S]*authPolicy: 'omit'[\s\S]*credentialsPolicy: 'omit'/);
  assert.doesNotMatch(dashboard, /SCENARIO_[123]/);
  assert.doesNotMatch(html, /dv2-information-tabs/);
});

test('无实时任务时使用五条诚实演示路线，实时任务存在时互斥且最多五条', async () => {
  const catalog = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-showcase-routes.v3.json', projectRoot), 'utf8'));
  assert.equal(localShowcaseRoutesAreValid(catalog), true);
  assert.equal(catalog.routes.length, 5);
  assert.match(catalog.disclaimer, /预设路线演示/);
  assert.match(catalog.disclaimer, /不代表实时履约或道路导航/);
  const showcase = selectChangchunRoutes({ public_map: { active_routes: [] } }, catalog);
  assert.equal(showcase.mode, 'SHOWCASE');
  assert.equal(showcase.routes.length, 5);
  const active_routes = Array.from({ length: 7 }, (_, index) => ({
    route_key: `live-${index}`, status: index === 6 ? 'IN_TRANSIT' : 'PUBLISHED',
    from: { longitude: 125.2, latitude: 44 }, to: { longitude: 125.3, latitude: 43.9 },
    alerts: index === 6 ? [{ message: '温度超限' }] : [],
    latest_location: { freshness: 'FRESH', recorded_at: `2026-08-14T0${index}:00:00+08:00` },
  }));
  const live = selectChangchunRoutes({ public_map: { active_routes } }, catalog);
  assert.equal(live.mode, 'LIVE');
  assert.equal(live.routes.length, 5);
  assert.equal(live.routes[0].live.route_key, 'live-6');
  assert.ok(live.routes.every((route) => !route.showcase));
});

test('全览保持静态，聚焦线路只有一个无拖尾且不可见路径的车辆符号', async () => {
  const catalog = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-showcase-routes.v3.json', projectRoot), 'utf8'));
  const overview = buildChangchunMapOption({ public_map: { points: [], active_routes: [] } }, SCREEN_PALETTES.night, null, catalog);
  assert.equal(overview.series.find((item) => item.name === '路线流动车辆').data.length, 0);
  const presentation = selectChangchunRoutes({ public_map: { active_routes: [] } }, catalog);
  const moving = buildChangchunMapOption({ public_map: { points: [], active_routes: [] } }, SCREEN_PALETTES.night, null, catalog, {
    selectedRouteKey: 'showcase-02', viewport: routeFocusViewport(presentation.routes[1], 'DETAIL'),
  });
  const routeSeries = moving.series.find((item) => item.name === '路线流动车辆');
  assert.equal(routeSeries.data.length, 1);
  assert.equal(routeSeries.effect.trailLength, 0);
  assert.equal(routeSeries.effect.symbol, 'arrow');
  assert.equal(routeSeries.polyline, true);
  assert.ok(routeSeries.data.every((item) => item.lineStyle.width === 0 && item.lineStyle.opacity === 0));
  const still = buildChangchunMapOption({ public_map: { points: [], active_routes: [] } }, SCREEN_PALETTES.night, null, catalog, { reducedMotion: true, selectedRouteKey: 'showcase-02', viewport: routeFocusViewport(presentation.routes[1], 'DETAIL') });
  assert.equal(still.series.find((item) => item.name === '路线流动车辆').effect.show, false);
  assert.equal(moving.series.find((item) => item.name === '配送展示路线').polyline, true);
  assert.equal(moving.series.find((item) => item.name === '配送展示路线').data[0].lineStyle.width, 5);
  assert.equal(moving.series.find((item) => item.name === '配送路线外侧衬线').lineStyle.width, 8);
  for (const series of moving.series) assert.equal(series.zlevel || 0, 0);
});

test('路线走廊 v3 去重保存并可连续重建五条终段与全程', async () => {
  const catalog = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-showcase-routes.v3.json', projectRoot), 'utf8'));
  const legacy = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-showcase-routes.v2.json', projectRoot), 'utf8'));
  const basemap = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-road-basemap.v4.geojson', projectRoot), 'utf8'));
  assert.equal(catalog.schema_version, '3.0');
  assert.equal(localShowcaseRoutesAreValid(catalog), true);
  assert.equal(new Set(catalog.corridors.map((corridor) => JSON.stringify(corridor.coordinates))).size, catalog.corridors.length);
  const corridorEdges = new Set();
  for (const corridor of catalog.corridors) {
    for (const edge of edgesOf(corridor.coordinates)) {
      assert.equal(corridorEdges.has(edge), false, `corridor edge is duplicated: ${corridor.corridor_key}`);
      corridorEdges.add(edge);
    }
  }
  const visibleConnectorEdges = new Set(basemap.features
    .filter((feature) => feature.properties?.layer === 'route_connector')
    .flatMap((feature) => edgesOf(feature.geometry.coordinates)));
  for (const corridor of catalog.corridors.filter((item) => item.kind !== 'ENTRANCE')) {
    for (const edge of edgesOf(corridor.coordinates)) {
      assert.ok(visibleConnectorEdges.has(edge), `route corridor is missing from the visible basemap: ${corridor.corridor_key}`);
    }
  }
  for (const route of catalog.routes) {
    const full = reconstructShowcaseRoute(catalog, route.corridor_keys);
    const detail = reconstructShowcaseRoute(catalog, route.detail_corridor_keys);
    const previousRoute = legacy.routes.find((item) => item.route_no === route.route_no);
    assert.ok(full.length >= detail.length && detail.length >= 2);
    assert.ok(route.detail_distance_km >= 10 && route.detail_distance_km <= 15);
    assert.deepEqual(full[0], [catalog.origin.longitude, catalog.origin.latitude]);
    assert.deepEqual(full.at(-1), previousRoute.coordinates.at(-1));
    assert.ok(Math.abs(lineLengthKm(full) - lineLengthKm(previousRoute.coordinates)) / lineLengthKm(previousRoute.coordinates) < 0.01);
    assert.ok(route.full_focus.zoom >= 1 && route.full_focus.zoom <= 6);
    assert.ok(route.detail_focus.zoom >= 1.4 && route.detail_focus.zoom <= 6);
  }
});

test('道路级路线 v2 包含五条完整折线、聚焦信息和小于百米吸附', async () => {
  const catalog = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-showcase-routes.v2.json', projectRoot), 'utf8'));
  assert.equal(catalog.schema_version, '2.0');
  assert.equal(localShowcaseRoutesAreValid(catalog), true);
  assert.equal(catalog.routes.length, 5);
  assert.ok(catalog.shared_corridor.length >= 2);
  for (const route of catalog.routes) {
    assert.ok(route.coordinates.length >= 25);
    assert.ok(route.origin_snap_distance_m <= 100);
    assert.ok(route.destination_snap_distance_m <= 100);
    assert.ok(route.maximum_cross_track_error_m <= 15);
    assert.ok(route.maximum_point_spacing_m <= 250);
    assert.ok(route.focus_zoom >= 1.4 && route.focus_zoom <= 6);
    assert.ok(route.branch_start_index > 0 && route.branch_start_index < route.coordinates.length);
  }
});

test('协同方案采用五行固定布局和两张结构化摘要卡', async () => {
  const css = await readFile(new URL('frontdesign-v1/dashboard.css', projectRoot), 'utf8');
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  assert.match(css, /grid-template-rows:\s*48px 32px 30px minmax\(0, 1fr\) 30px/);
  assert.match(css, /\.dv2-showcase-footer\s*\{[^}]*display:\s*flex/s);
  assert.match(dashboard, /allocations \|\| \[\]\)\.slice\(0, 2\)\.map\(showcaseAllocationSummary\)/);
  for (const field of ['primaryMetrics', 'secondaryMetrics', 'detail']) assert.match(dashboard, new RegExp(field));
  assert.match(dashboard, /首要原因：/);
  assert.equal((dashboard.match(/renderShowcase\(snapshot\.algorithm_showcase\)/g) || []).length, 1);
});

test('麦克风使用居中的内联 SVG 且各状态只动画外层光圈', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const css = await readFile(new URL('frontdesign-v1/dashboard.css', projectRoot), 'utf8');
  const mic = html.match(/<button id="dv2-mic-button"[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(mic, /<svg viewBox="0 0 24 24"/);
  assert.doesNotMatch(mic, /<i><\/i>/);
  assert.match(css, /\.dv2-mic\s*\{[^}]*place-items:\s*center/s);
  assert.match(css, /\.dv2-mic svg\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/s);
  assert.match(css, /\.dv2-mic span\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(css, /\.dv2-mic i::after/);
});

test('E01 主表使用今日序号和列白名单，原编号只进入登录详情', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  assert.match(html, /id="e01-resource-dialog"/);
  assert.match(scripts, /const RESOURCE_TABLE_SCHEMAS/);
  assert.match(scripts, /今日序号/);
  assert.match(scripts, /padStart\(2, '0'\)/);
  assert.match(scripts, /data-row-index=/);
  assert.match(scripts, /原始记录编号/);
  assert.doesNotMatch(scripts, /data-(?:id|record-id)=/);
  assert.match(scripts, /!isTechnicalField\(field\)/);
  const ordinalSource = scripts.match(/function todayOrdinal\([\s\S]*?\n\}/)?.[0];
  const ordinal = Function(`${ordinalSource}; return todayOrdinal;`)();
  assert.equal(ordinal(1, 20, 0), '01');
  assert.equal(ordinal(2, 20, 0), '21');
  assert.equal(ordinal(5, 20, 19), '100');
});

test('E02 双环放大且中心主值与单位分离', async () => {
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  assert.match(dashboard, /radius:\s*expanded \? \['63%', '88%'\]/);
  assert.match(dashboard, /centerPrimary:\s*formatNumber\(orderTotal\), centerUnit:\s*'笔'/);
  assert.match(dashboard, /centerPrimary:\s*salesPrimary, centerUnit:\s*salesUnit/);
  assert.match(dashboard, /width:\s*expanded \? 64/);
});

test('主题切换只重绘当前长春地图和方案且不请求接口', async () => {
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  const start = dashboard.indexOf('function setTheme(');
  const end = dashboard.indexOf('\n}', start) + 2;
  const body = dashboard.slice(start, end);
  assert.match(body, /renderMap/);
  assert.doesNotMatch(body, /fetch\(|API\.|refresh\(/);
});
