import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildChangchunMapOption,
  localGeoJsonIsChangchunRoadBasemap,
  localGeoJsonIsChangchunServiceArea,
} from '../dashboard-map.js';
import { SCREEN_PALETTES } from '../dashboard-format.js';

const projectRoot = new URL('../../', import.meta.url);

test('长春服务范围 GeoJSON 只包含有效面几何并进入本地构建', async () => {
  const source = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-service-area.geojson', projectRoot), 'utf8'));
  assert.equal(localGeoJsonIsChangchunServiceArea(source), true);
  assert.ok(source.features.length > 0);
  assert.match(JSON.stringify(source), /EPSG:4326/);
});

test('长春道路底图固定为首方 ODbL 矢量资产并包含必要图层', async () => {
  const source = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-road-basemap.v1.geojson', projectRoot), 'utf8'));
  assert.equal(localGeoJsonIsChangchunRoadBasemap(source), true);
  assert.equal(source.metadata.crs, 'EPSG:4326');
  assert.equal(source.metadata.coordinate_order, 'longitude,latitude');
  assert.equal(source.metadata.license, 'ODbL 1.0');
  assert.deepEqual(source.metadata.clip_bounds, [125.15, 43.6, 125.6, 44.02]);
  const layers = new Set(source.features.map((feature) => feature.properties.layer));
  for (const layer of ['motorway', 'primary', 'secondary', 'railway', 'waterway', 'place_label']) assert.ok(layers.has(layer));
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
  assert.equal(option.series.find((item) => item.name === '有效运输路线').data.length, 1);
  assert.equal(option.series.find((item) => item.name === '独立温湿度报警').data.length, 1);
  assert.notEqual(option.series.find((item) => item.name === '有效运输路线').data[0].lineStyle.color, SCREEN_PALETTES.night.danger);
});

test('长春道路、标签与业务覆盖层共用固定不可漫游 geo 坐标系', async () => {
  const basemap = JSON.parse(await readFile(new URL('frontdesign-v1/assets/maps/changchun-road-basemap.v1.geojson', projectRoot), 'utf8'));
  const option = buildChangchunMapOption({ public_map: { points: [], active_routes: [] } }, SCREEN_PALETTES.day, basemap);
  assert.equal(option.geo.roam, false);
  assert.ok(option.series.some((series) => series.name === '高速与快速路' && series.silent === true));
  assert.ok(option.series.some((series) => series.name === '主要水系' && series.silent === true));
  assert.ok(option.series.some((series) => series.name === '铁路' && series.silent === true));
  assert.ok(option.series.some((series) => series.name === '长春片区标签' && series.silent === true));
  for (const series of option.series) assert.equal(series.coordinateSystem, 'geo');
});

test('E02 包含资讯与四类协同方案并使用无认证公开请求', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  for (const marker of ['dv2-information-list', 'dv2-showcase-content', 'dv2-algorithm-dialog']) assert.match(html, new RegExp(marker));
  for (const marker of ['dv2-ranking-loop-toggle', 'dv2-information-loop-toggle', 'dv2-showcase-summary']) assert.match(html, new RegExp(marker));
  for (const kind of ['CARPOOL', 'WAREHOUSE', 'PROCUREMENT', 'FORECAST']) assert.match(html, new RegExp(`data-kind="${kind}"`));
  assert.match(api, /getPublicInformation[\s\S]*authPolicy: 'omit'[\s\S]*credentialsPolicy: 'omit'/);
  assert.match(api, /getDashboardSnapshot[\s\S]*authPolicy: 'omit'[\s\S]*credentialsPolicy: 'omit'/);
  assert.doesNotMatch(dashboard, /SCENARIO_[123]/);
});

test('协同方案采用五行固定布局和两张结构化摘要卡', async () => {
  const css = await readFile(new URL('frontdesign-v1/dashboard.css', projectRoot), 'utf8');
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  assert.match(css, /grid-template-rows:\s*48px 32px 30px minmax\(0, 1fr\) 30px/);
  assert.match(css, /\.dv2-showcase-footer\s*\{[^}]*display:\s*flex/s);
  assert.match(dashboard, /allocations \|\| \[\]\)\.slice\(0, 2\)\.map\(showcaseAllocationSummary\)/);
  for (const field of ['primaryMetrics', 'secondaryMetrics', 'detail']) assert.match(dashboard, new RegExp(field));
  assert.match(dashboard, /首要原因：/);
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
