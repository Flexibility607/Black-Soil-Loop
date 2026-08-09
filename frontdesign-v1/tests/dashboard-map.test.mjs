import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildNortheastMapOption, harbinIsNorthOfChangchun, localGeoJsonIsNortheast, REFERENCE_CITIES } from '../dashboard-map.js';
import { SCREEN_PALETTES } from '../dashboard-format.js';

test('哈尔滨纬度高于长春且长春位于吉林', () => {
  assert.equal(harbinIsNorthOfChangchun(), true);
  const harbin = REFERENCE_CITIES.find((item) => item.name === '哈尔滨市');
  const changchun = REFERENCE_CITIES.find((item) => item.name === '长春市');
  assert.ok(harbin.value[1] > changchun.value[1]);
});

test('本地 Natural Earth 文件包含东北三省', async () => {
  const geojson = JSON.parse(await readFile(new URL('../assets/maps/northeast-china-admin1.geojson', import.meta.url), 'utf8'));
  assert.equal(localGeoJsonIsNortheast(geojson), true);
  assert.equal(geojson.source.title, 'Natural Earth Admin 1 - States, Provinces');
  assert.match(geojson.crs.properties.name, /CRS84/);
});

test('地图点位与供销连线共用 EPSG:4326 坐标', () => {
  const snapshot = {
    map_nodes: [
      { node_id: 'park', node_type: 'PARK', display_name: '园区', longitude: 125.182, latitude: 44.432 },
      { node_id: 'space', node_type: 'THIRD_SPACE', display_name: '第三空间', longitude: 125.326, latitude: 43.879 },
    ],
    map_edges: [{ source_id: 'park', target_id: 'space', channel_type: 'THIRD_SPACE' }],
  };
  const option = buildNortheastMapOption(snapshot);
  assert.deepEqual(option.series[0].data[0].coords, [[125.182, 44.432], [125.326, 43.879]]);
  assert.deepEqual(option.series[1].data[1].value.slice(0, 2), [125.326, 43.879]);
});

test('地图根据日夜色板同步背景、标签和提示框', () => {
  const snapshot = {
    map_nodes: [{ node_id: 'park', node_type: 'PARK', display_name: '园区', longitude: 125.182, latitude: 44.432 }],
    map_edges: [],
  };
  const day = buildNortheastMapOption(snapshot, SCREEN_PALETTES.day);
  const night = buildNortheastMapOption(snapshot, SCREEN_PALETTES.night);
  assert.equal(day.geo.itemStyle.areaColor, SCREEN_PALETTES.day.mapArea);
  assert.equal(day.tooltip.backgroundColor, SCREEN_PALETTES.day.tooltipBackground);
  assert.equal(day.series[1].label.textBorderColor, SCREEN_PALETTES.day.mapTextBorder);
  assert.notEqual(day.geo.itemStyle.areaColor, night.geo.itemStyle.areaColor);
});
