import { SCREEN_PALETTES } from './dashboard-format.js?v=20260813-dashboard-presentation-2';

export const REFERENCE_CITIES = [
  { name: '哈尔滨市', value: [126.642, 45.757] },
  { name: '长春市', value: [125.324, 43.817] },
  { name: '沈阳市', value: [123.431, 41.805] },
];

export function harbinIsNorthOfChangchun(cities = REFERENCE_CITIES) {
  const harbin = cities.find((item) => item.name === '哈尔滨市');
  const changchun = cities.find((item) => item.name === '长春市');
  return Boolean(harbin && changchun && harbin.value[1] > changchun.value[1]);
}

export function localGeoJsonIsNortheast(geojson) {
  const names = new Set((geojson?.features || []).map((feature) => feature?.properties?.name));
  return ['黑龙江省', '吉林省', '辽宁省'].every((name) => names.has(name));
}

export function localGeoJsonIsChangchunServiceArea(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  if (!features.length) return false;
  return features.every((feature) => {
    const type = feature?.geometry?.type;
    return type === 'Polygon' || type === 'MultiPolygon';
  });
}

export function localGeoJsonIsChangchunRoadBasemap(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const layers = new Set(features.map((feature) => feature?.properties?.layer));
  if (geojson?.metadata?.crs !== 'EPSG:4326' || geojson?.metadata?.license !== 'ODbL 1.0') return false;
  if (!['motorway', 'primary', 'secondary', 'railway', 'waterway', 'place_label'].every((layer) => layers.has(layer))) return false;
  return features.every((feature) => {
    const geometry = feature?.geometry;
    if (geometry?.type === 'Point') return geometry.coordinates?.length === 2 && geometry.coordinates.every(Number.isFinite);
    return geometry?.type === 'LineString' && geometry.coordinates?.length > 1
      && geometry.coordinates.every((point) => point.length === 2 && point.every(Number.isFinite));
  });
}

function nodeColor(type, palette) {
  if (type === 'PARK') return palette.demand;
  if (type === 'THIRD_SPACE') return palette.thirdSpace;
  return palette.traditional;
}

const TRANSPORT_STATUS_LABELS = {
  DRAFT: '草稿', MATCHED: '已匹配', CONFIRMED: '已确认', READY: '执行任务已就绪',
  PUBLISH_REQUESTED: '发布处理中', PUBLISHED: '已发布', DRIVER_ACCEPTED: '司机已接单',
  PICKED_UP: '已取货', IN_TRANSIT: '运输中', DELIVERED: '已送达', STORE_SIGNED: '门店已签收',
  COMPLETED: '已完成', CANCELLATION_REQUESTED: '取消处理中', CANCELLATION_REJECTED: '取消申请被拒绝',
  CANCELLED: '已取消',
};

export function applyDashboardMapDictionaries(dictionaries) {
  Object.assign(TRANSPORT_STATUS_LABELS, dictionaries?.transport_status || {});
}

function statusLabel(status) {
  return TRANSPORT_STATUS_LABELS[status] || `未知类型（${status || '空值'}）`;
}

export function buildNortheastMapOption(snapshot, palette = SCREEN_PALETTES.night) {
  const colors = { ...SCREEN_PALETTES.night, ...palette };
  const nodeById = new Map((snapshot.map_nodes || []).map((node) => [node.node_id, node]));
  const lines = (snapshot.map_edges || []).map((edge) => {
    const source = nodeById.get(edge.source_id);
    const target = nodeById.get(edge.target_id);
    if (!source || !target) return null;
    const location = edge.latest_location;
    const start = location
      ? [Number(location.longitude), Number(location.latitude)]
      : [Number(source.longitude), Number(source.latitude)];
    return {
      name: `${edge.task_no || edge.task_id || '运输任务'} · ${location ? '车辆当前位置至站点估算路线' : edge.route_label || '经纬度估算路线'}`,
      coords: [start, [Number(target.longitude), Number(target.latitude)]],
      taskStatus: edge.status,
      telemetry: edge.latest_telemetry,
      location,
      environmentalAlerts: edge.environmental_alerts || [],
      locationFallback: !location,
      abnormal: edge.abnormal,
      lineStyle: { color: edge.abnormal ? colors.danger : edge.channel_type === 'THIRD_SPACE' ? colors.thirdSpace : colors.traditional },
    };
  }).filter(Boolean);

  const storeNodes = (snapshot.map_nodes || []).map((node) => ({
    name: node.display_name,
    value: [Number(node.longitude), Number(node.latitude), node.node_type],
    itemStyle: { color: nodeColor(node.node_type, colors) },
    symbolSize: node.node_type === 'PARK' ? 19 : node.node_type === 'THIRD_SPACE' ? 12 : 9,
  }));

  const vehicleByTask = new Map();
  for (const edge of snapshot.map_edges || []) {
    const location = edge.latest_location;
    if (!location || vehicleByTask.has(edge.task_id)) continue;
    vehicleByTask.set(edge.task_id, {
      name: edge.plate_no || edge.task_no || edge.task_id || '运输车辆',
      value: [Number(location.longitude), Number(location.latitude)],
      taskId: edge.task_id,
      speedMps: location.speed_mps,
      accuracyM: location.accuracy_m,
      recordedAt: location.recorded_at,
    });
  }
  const vehicleNodes = [...vehicleByTask.values()];

  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      backgroundColor: colors.tooltipBackground,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.text },
      formatter(params) {
        if (params.seriesName === '节点') return `${params.name}<br/>${params.value?.[2] === 'PARK' ? '园区中心' : params.value?.[2] === 'THIRD_SPACE' ? '第三空间' : '传统门店'}`;
        if (params.seriesName === '估算运输路线') {
          const telemetry = params.data?.telemetry;
          const status = statusLabel(params.data?.taskStatus);
          const location = params.data?.location;
          const locationText = location
            ? `<br/>车辆位置采样 ${location.recorded_at || '—'} · 速度 ${location.speed_mps ?? '—'} 米/秒 · 精度 ${location.accuracy_m ?? '—'} 米`
            : '<br/>暂无车辆位置，当前从任务起点绘制经纬度估算路线';
          const alerts = params.data?.environmentalAlerts || [];
          const alertText = alerts.length
            ? `<br/>独立温湿度报警：${alerts.map((item) => item.message || item.alert_type).join('；')}`
            : '<br/>独立温湿度报警：无';
          const environmental = telemetry
            ? `<br/>温度 ${telemetry.temperature_c ?? '—'} ℃ · 湿度 ${telemetry.humidity_pct ?? '—'}%<br/>采样 ${telemetry.sampled_at || '—'}`
            : '<br/>暂无温湿度采样';
          return `${params.name}<br/>状态：${status}${locationText}${environmental}${alertText}`;
        }
        if (params.seriesName === '车辆当前位置') {
          return `${params.name}<br/>位置采样：${params.data.recordedAt || '—'}<br/>速度：${params.data.speedMps ?? '—'} 米/秒 · 定位精度：${params.data.accuracyM ?? '—'} 米`;
        }
        return params.name || '';
      },
    },
    geo: {
      map: 'northeast-admin1',
      roam: true,
      zoom: 1.05,
      center: [125.2, 44.1],
      layoutCenter: ['50%', '51%'],
      layoutSize: '101%',
      label: { show: true, color: colors.mapLabel, fontSize: 13 },
      itemStyle: {
        areaColor: colors.mapArea,
        borderColor: colors.mapBorder,
        borderWidth: 1.2,
        shadowColor: colors.mapShadow,
        shadowBlur: 16,
      },
      emphasis: { itemStyle: { areaColor: colors.mapEmphasis }, label: { color: colors.text } },
    },
    series: [
      {
        name: '估算运输路线',
        type: 'lines',
        coordinateSystem: 'geo',
        zlevel: 2,
        silent: false,
        effect: { show: true, period: 6, trailLength: 0.22, symbolSize: 3, color: colors.mapEffect },
        lineStyle: { width: 1.4, opacity: 0.72, curveness: 0.18 },
        data: lines,
      },
      {
        name: '节点',
        type: 'effectScatter',
        coordinateSystem: 'geo',
        zlevel: 3,
        rippleEffect: { scale: 2.8, brushType: 'stroke' },
        label: {
          show: true,
          formatter: '{b}',
          position: 'right',
          distance: 8,
          color: colors.text,
          fontSize: 11,
          textBorderColor: colors.mapTextBorder,
          textBorderWidth: 3,
        },
        data: storeNodes,
      },
      {
        name: '车辆当前位置',
        type: 'effectScatter',
        coordinateSystem: 'geo',
        zlevel: 5,
        symbol: 'diamond',
        symbolSize: 15,
        rippleEffect: { scale: 3.2, brushType: 'stroke' },
        itemStyle: { color: colors.vehicle, borderColor: colors.vehicleBorder, borderWidth: 1 },
        label: { show: true, formatter: '{b}', position: 'top', color: colors.vehicleLabel, fontSize: 10 },
        data: vehicleNodes,
      },
      {
        name: '城市参照',
        type: 'scatter',
        coordinateSystem: 'geo',
        zlevel: 1,
        symbolSize: 5,
        silent: true,
        itemStyle: { color: colors.mapReference },
        label: { show: true, formatter: '{b}', position: 'top', color: colors.mapReference, fontSize: 10 },
        data: REFERENCE_CITIES,
      },
    ],
  };
}

function publicPointTooltip(point) {
  const type = point.point_type === 'THIRD_SPACE' ? '第三空间' : '普通销售门店';
  const note = point.coordinate_note ? `<br/>${point.coordinate_note}` : '';
  return `${point.display_name}<br/>${type}<br/>${point.address || '地址待补充'}${note}`;
}

function publicRouteTooltip(route) {
  const location = route.latest_location;
  const telemetry = route.latest_telemetry;
  const locationText = location
    ? `<br/>位置采样：${location.recorded_at || '—'}<br/>速度：${location.speed_mps ?? '—'} 米/秒 · 定位精度：${location.accuracy_m ?? '—'} 米 · ${location.freshness || '未知时效'}`
    : '<br/>暂无有效车辆位置，使用任务起点估算';
  const telemetryText = telemetry
    ? `<br/>温度 ${telemetry.temperature_c ?? '—'} ℃ · 湿度 ${telemetry.humidity_pct ?? '—'}% · 采样 ${telemetry.sampled_at || '—'}${telemetry.anomaly_code ? `<br/>遥测异常提示：${telemetry.anomaly_code}` : ''}`
    : '<br/>暂无温湿度采样';
  const alerts = Array.isArray(route.alerts) ? route.alerts : [];
  const alertText = alerts.length
    ? `<br/>独立报警：${alerts.map((item) => item.message || item.alert_type_label || item.alert_type).join('；')}${Number(route.alert_count || 0) > alerts.length ? ` 等 ${route.alert_count} 条` : ''}`
    : '<br/>独立报警：无';
  return `${route.vehicle_label || '配送车辆'} → ${route.to?.display_name || '运输目标点'}<br/>${route.status_label || statusLabel(route.status)} · ${route.route_label || '经纬度估算路线'}${locationText}${telemetryText}${alertText}`;
}

function basemapSeries(basemap, colors) {
  if (!Array.isArray(basemap?.features)) return [];
  const layerStyles = {
    motorway: { color: colors.mapRoadMotorway, width: 1.8 },
    trunk: { color: colors.mapRoadTrunk, width: 1.45 },
    primary: { color: colors.mapRoadPrimary, width: 1.05 },
    secondary: { color: colors.mapRoadSecondary, width: 0.75 },
    tertiary: { color: colors.mapRoadSecondary, width: 0.55, opacity: 0.72 },
    railway: { color: colors.mapRailway, width: 0.65, type: 'dashed' },
    waterway: { color: colors.mapWaterway, width: 0.85 },
    district_boundary: { color: colors.mapDistrict, width: 0.7, type: 'dashed' },
  };
  const groups = new Map();
  const labels = [];
  for (const feature of basemap.features) {
    const layer = feature?.properties?.layer;
    const geometry = feature?.geometry;
    if (layer === 'place_label' && geometry?.type === 'Point') {
      labels.push({ name: feature.properties.name, value: geometry.coordinates });
      continue;
    }
    if (geometry?.type !== 'LineString' || !layerStyles[layer]) continue;
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push({ name: feature.properties.name || '', coords: geometry.coordinates });
  }
  const names = { motorway: '高速与快速路', trunk: '国省干线', primary: '城市主干路', secondary: '城市次干路', tertiary: '连接道路', railway: '铁路', waterway: '主要水系', district_boundary: '片区边界' };
  const result = [...groups].map(([layer, data], index) => ({
    name: names[layer], type: 'lines', coordinateSystem: 'geo', zlevel: 0, silent: true,
    progressive: 800, large: data.length > 1000, largeThreshold: 800,
    lineStyle: { opacity: 1, curveness: 0, ...layerStyles[layer] }, data,
  }));
  if (labels.length) result.push({
    name: '长春片区标签', type: 'scatter', coordinateSystem: 'geo', zlevel: 1, silent: true,
    symbolSize: 2, itemStyle: { color: 'transparent' },
    label: { show: true, formatter: '{b}', position: 'top', color: colors.mapPlaceLabel, fontSize: 9, textBorderColor: colors.mapTextBorder, textBorderWidth: 2 },
    data: labels,
  });
  return result.map((series, index) => ({ ...series, z: index + 1 }));
}

export function buildChangchunMapOption(snapshot, palette = SCREEN_PALETTES.night, basemap = null) {
  const colors = { ...SCREEN_PALETTES.night, ...palette };
  const publicMap = snapshot.public_map || snapshot.map || {};
  const points = (publicMap.points || []).map((point) => ({
    name: point.display_name,
    value: [Number(point.longitude), Number(point.latitude)],
    point,
    symbolSize: point.point_type === 'THIRD_SPACE' ? 14 : 10,
    itemStyle: { color: point.point_type === 'THIRD_SPACE' ? colors.thirdSpace : colors.traditional },
  })).filter((point) => point.value.every(Number.isFinite));
  const routes = (publicMap.active_routes || []).map((route) => {
    const from = route.from;
    const target = route.to;
    const coords = [[Number(from?.longitude), Number(from?.latitude)], [Number(target?.longitude), Number(target?.latitude)]];
    if (!coords.flat().every(Number.isFinite)) return null;
    return {
      name: `${route.vehicle_label || '配送车辆'} → ${target?.display_name || '运输目标点'}`,
      coords,
      route,
      lineStyle: {
        color: target?.channel === 'THIRD_SPACE' ? colors.thirdSpace : colors.traditional,
        type: route.latest_location?.freshness === 'DELAYED' || route.fallback ? 'dashed' : 'solid',
        opacity: route.latest_location?.freshness === 'DELAYED' ? 0.5 : 0.78,
      },
    };
  }).filter(Boolean);
  const vehicles = routes.filter((item) => item.route.from?.kind === 'VEHICLE').map((item) => ({
    name: item.route.vehicle_label || '配送车辆',
    value: item.coords[0],
    route: item.route,
  }));
  const alerts = routes.filter((item) => Number(item.route.alert_count || item.route.alerts?.length || 0) > 0).map((item) => ({
    name: `${item.route.to?.display_name || '运输目标点'}报警`,
    value: item.coords[1],
    route: item.route,
  }));
  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      backgroundColor: colors.tooltipBackground,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.text },
      formatter(params) {
        if (params.seriesName === '精选点位') return publicPointTooltip(params.data.point);
        if (['有效运输路线', '车辆当前位置', '独立温湿度报警'].includes(params.seriesName)) return publicRouteTooltip(params.data.route);
        return params.name || '';
      },
    },
    geo: {
      map: 'changchun-service-area',
      roam: false,
      layoutCenter: ['50%', '51%'],
      layoutSize: '97%',
      label: { show: false },
      itemStyle: { areaColor: colors.mapArea, borderColor: colors.mapBorder, borderWidth: 1.2, shadowColor: colors.mapShadow, shadowBlur: 16 },
      emphasis: { itemStyle: { areaColor: colors.mapEmphasis } },
    },
    series: [
      ...basemapSeries(basemap, colors),
      {
        name: '有效运输路线', type: 'lines', coordinateSystem: 'geo', zlevel: 2,
        effect: { show: true, period: 7, trailLength: 0.18, symbolSize: 3, color: colors.mapEffect },
        lineStyle: { width: 1.6, curveness: 0.08 }, data: routes,
      },
      {
        name: '精选点位', type: 'effectScatter', coordinateSystem: 'geo', zlevel: 3,
        rippleEffect: { scale: 2.4, brushType: 'stroke' },
        label: { show: true, formatter: '{b}', position: 'right', distance: 6, color: colors.text, fontSize: 10, textBorderColor: colors.mapTextBorder, textBorderWidth: 3 },
        data: points,
      },
      {
        name: '车辆当前位置', type: 'effectScatter', coordinateSystem: 'geo', zlevel: 5,
        symbol: 'diamond', symbolSize: 14, rippleEffect: { scale: 3, brushType: 'stroke' },
        itemStyle: { color: colors.vehicle, borderColor: colors.vehicleBorder, borderWidth: 1 }, data: vehicles,
      },
      {
        name: '独立温湿度报警', type: 'effectScatter', coordinateSystem: 'geo', zlevel: 6,
        symbolSize: 19, rippleEffect: { scale: 3.5, brushType: 'stroke' },
        itemStyle: { color: colors.danger }, data: alerts,
      },
    ],
  };
}
