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

test('地图优先从车辆最新位置绘制路线并展示采样信息', () => {
  const snapshot = {
    map_nodes: [
      { node_id: 'park', node_type: 'PARK', display_name: '园区', longitude: 125.182, latitude: 44.432 },
      { node_id: 'space', node_type: 'THIRD_SPACE', display_name: '第三空间', longitude: 125.326, latitude: 43.879 },
    ],
    map_edges: [{
      task_id: 'task-1', task_no: '任务一', plate_no: '黑A12345', source_id: 'park', target_id: 'space',
      latest_location: { longitude: 125.25, latitude: 44.1, speed_mps: 12.5, accuracy_m: 6, recorded_at: '2026-08-08T08:00:00Z' },
      environmental_alerts: [{ alert_type: 'TEMPERATURE', message: '温度超限' }],
    }],
  };
  const option = buildNortheastMapOption(snapshot);
  assert.deepEqual(option.series[0].data[0].coords, [[125.25, 44.1], [125.326, 43.879]]);
  const vehicles = option.series.find((series) => series.name === '车辆当前位置');
  assert.deepEqual(vehicles.data[0].value, [125.25, 44.1]);
  assert.equal(vehicles.data[0].accuracyM, 6);
  const tooltip = option.tooltip.formatter({ seriesName: '估算运输路线', name: '任务一', data: option.series[0].data[0] });
  assert.match(tooltip, /速度 12.5 米\/秒/);
  assert.match(tooltip, /独立温湿度报警：温度超限/);
});

test('没有车辆位置时回退到任务起点估算路线', () => {
  const option = buildNortheastMapOption({
    map_nodes: [
      { node_id: 'park', node_type: 'PARK', display_name: '园区', longitude: 125.182, latitude: 44.432 },
      { node_id: 'space', node_type: 'THIRD_SPACE', display_name: '第三空间', longitude: 125.326, latitude: 43.879 },
    ],
    map_edges: [{ task_id: 'task-1', source_id: 'park', target_id: 'space' }],
  });
  assert.deepEqual(option.series[0].data[0].coords, [[125.182, 44.432], [125.326, 43.879]]);
  assert.equal(option.series.find((series) => series.name === '车辆当前位置').data.length, 0);
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
  assert.equal(day.series.find((series) => series.name === '节点').label.textBorderColor, SCREEN_PALETTES.day.mapTextBorder);
  assert.notEqual(day.geo.itemStyle.areaColor, night.geo.itemStyle.areaColor);
});

test('日夜主题均保留车辆位置、定位详情、独立报警和无位置回退', () => {
  const mapNodes = [
    { node_id: 'park', node_type: 'PARK', display_name: '园区', longitude: 125.182, latitude: 44.432 },
    { node_id: 'space', node_type: 'THIRD_SPACE', display_name: '第三空间', longitude: 125.326, latitude: 43.879 },
  ];
  const locatedEdge = {
    task_id: 'task-1', task_no: '任务一', plate_no: '黑A12345', source_id: 'park', target_id: 'space',
    latest_location: { longitude: 125.25, latitude: 44.1, speed_mps: 12.5, accuracy_m: 6, recorded_at: '2026-08-08T08:00:00Z' },
    environmental_alerts: [{ alert_type: 'TEMPERATURE', message: '温度超限' }],
  };
  const vehicleColors = [];

  for (const palette of [SCREEN_PALETTES.day, SCREEN_PALETTES.night]) {
    const located = buildNortheastMapOption({ map_nodes: mapNodes, map_edges: [locatedEdge] }, palette);
    assert.deepEqual(located.series[0].data[0].coords, [[125.25, 44.1], [125.326, 43.879]]);
    const vehicles = located.series.find((series) => series.name === '车辆当前位置');
    assert.deepEqual(vehicles.data[0].value, [125.25, 44.1]);
    assert.equal(vehicles.data[0].accuracyM, 6);
    vehicleColors.push(vehicles.itemStyle.color);
    const tooltip = located.tooltip.formatter({ seriesName: '估算运输路线', name: '任务一', data: located.series[0].data[0] });
    assert.match(tooltip, /速度 12.5 米\/秒/);
    assert.match(tooltip, /定位精度|精度 6 米/);
    assert.match(tooltip, /独立温湿度报警：温度超限/);

    const fallback = buildNortheastMapOption({
      map_nodes: mapNodes,
      map_edges: [{ task_id: 'task-1', source_id: 'park', target_id: 'space' }],
    }, palette);
    assert.deepEqual(fallback.series[0].data[0].coords, [[125.182, 44.432], [125.326, 43.879]]);
    assert.equal(fallback.series.find((series) => series.name === '车辆当前位置').data.length, 0);
  }
  assert.notEqual(vehicleColors[0], vehicleColors[1]);
});
