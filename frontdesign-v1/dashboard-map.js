import { SCREEN_PALETTES } from './dashboard-format.js?v=20260814-dashboard-presentation-4';

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
    if (geometry?.type === 'LineString') return geometry.coordinates?.length > 1
      && geometry.coordinates.every((point) => point.length === 2 && point.every(Number.isFinite));
    if (geometry?.type === 'MultiLineString') return geometry.coordinates?.length > 0
      && geometry.coordinates.every((line) => line.length > 1 && line.every((point) => point.length === 2 && point.every(Number.isFinite)));
    if (geometry?.type === 'Polygon') return geometry.coordinates?.length > 0
      && geometry.coordinates.every((ring) => ring.length >= 4 && ring.every((point) => point.length === 2 && point.every(Number.isFinite)));
    return false;
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
        polyline: true,
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

export function localShowcaseRoutesAreValid(catalog) {
  const routes = catalog?.routes;
  if (!['1.0', '2.0'].includes(catalog?.schema_version) || catalog?.crs !== 'EPSG:4326' || !Array.isArray(routes) || routes.length !== 5) return false;
  return routes.every((route, index) => route.route_no === String(index + 1).padStart(2, '0')
    && route.destination_name
    && Number.isFinite(Number(route.estimated_distance_km))
    && Array.isArray(route.coordinates)
    && route.coordinates.length >= (catalog.schema_version === '2.0' ? 25 : 2)
    && route.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))
    && (catalog.schema_version !== '2.0' || (
      Array.isArray(route.bounds) && route.bounds.length === 4 && route.bounds.every(Number.isFinite)
      && Array.isArray(route.focus_center) && route.focus_center.length === 2 && route.focus_center.every(Number.isFinite)
      && Number(route.focus_zoom) >= 1.4 && Number(route.focus_zoom) <= 6
      && Number.isInteger(route.branch_start_index) && route.branch_start_index >= 1 && route.branch_start_index < route.coordinates.length
      && Number(route.origin_snap_distance_m) <= 100 && Number(route.destination_snap_distance_m) <= 100
    )));
}

export const MAP_SCALE_LIMIT = Object.freeze({ min: 1, max: 8 });

export function normalizeMapViewport(viewport = {}) {
  const zoom = Math.min(MAP_SCALE_LIMIT.max, Math.max(MAP_SCALE_LIMIT.min, Number(viewport.zoom) || 1));
  const center = Array.isArray(viewport.center) && viewport.center.length === 2 && viewport.center.every(Number.isFinite)
    ? viewport.center.map(Number)
    : null;
  return { mode: viewport.mode || 'OVERVIEW', center, zoom, selectedRouteKey: viewport.selectedRouteKey || null };
}

export function overviewMapViewport(basemap = null) {
  const bounds = basemap?.metadata?.clip_bounds;
  const center = Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)
    ? [Number(((bounds[0] + bounds[2]) / 2).toFixed(7)), Number(((bounds[1] + bounds[3]) / 2).toFixed(7))]
    : [125.375, 43.85];
  return { mode: 'OVERVIEW', center, zoom: 1, selectedRouteKey: null };
}

function routeBounds(route) {
  if (Array.isArray(route?.showcase?.bounds) && route.showcase.bounds.length === 4) return route.showcase.bounds;
  const coordinates = route?.coordinates || [];
  if (!coordinates.length) return null;
  const longitudes = coordinates.map((point) => Number(point[0])).filter(Number.isFinite);
  const latitudes = coordinates.map((point) => Number(point[1])).filter(Number.isFinite);
  if (!longitudes.length || !latitudes.length) return null;
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
}

export function routeFocusViewport(route) {
  if (Array.isArray(route?.showcase?.focus_center) && route.showcase.focus_center.length === 2
    && route.showcase.focus_center.every(Number.isFinite) && Number.isFinite(Number(route.showcase.focus_zoom))) {
    return normalizeMapViewport({ mode: 'ROUTE_FOCUS', center: route.showcase.focus_center, zoom: route.showcase.focus_zoom, selectedRouteKey: route.key });
  }
  const bounds = routeBounds(route);
  if (!bounds) return normalizeMapViewport({ mode: 'ROUTE_FOCUS', zoom: 1.4, selectedRouteKey: route?.key });
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = bounds;
  const center = [Number(((minLongitude + maxLongitude) / 2).toFixed(7)), Number(((minLatitude + maxLatitude) / 2).toFixed(7))];
  const longitudeSpan = Math.max(0.001, maxLongitude - minLongitude);
  const latitudeSpan = Math.max(0.001, maxLatitude - minLatitude);
  const zoom = Math.max(1.4, Math.min(6, 0.48 / Math.max(longitudeSpan, latitudeSpan * 1.18)));
  return normalizeMapViewport({ mode: 'ROUTE_FOCUS', center, zoom, selectedRouteKey: route?.key });
}

const LIVE_STATUS_PRIORITY = Object.freeze({ IN_TRANSIT: 5, PICKED_UP: 4, DRIVER_ACCEPTED: 3, PUBLISHED: 2, READY: 1 });
const LOCATION_PRIORITY = Object.freeze({ FRESH: 3, DELAYED: 2, STALE: 1 });

function liveRouteSort(left, right) {
  const alertDifference = Number(right.alert_count || right.alerts?.length || 0) - Number(left.alert_count || left.alerts?.length || 0);
  if (alertDifference) return alertDifference;
  const statusDifference = Number(LIVE_STATUS_PRIORITY[right.status] || 0) - Number(LIVE_STATUS_PRIORITY[left.status] || 0);
  if (statusDifference) return statusDifference;
  const freshnessDifference = Number(LOCATION_PRIORITY[right.latest_location?.freshness] || 0) - Number(LOCATION_PRIORITY[left.latest_location?.freshness] || 0);
  if (freshnessDifference) return freshnessDifference;
  const recordedDifference = String(right.latest_location?.recorded_at || '').localeCompare(String(left.latest_location?.recorded_at || ''));
  if (recordedDifference) return recordedDifference;
  return String(left.route_key || '').localeCompare(String(right.route_key || ''), 'en');
}

export function selectChangchunRoutes(snapshot, showcaseCatalog = null) {
  const activeRoutes = [...(snapshot?.public_map?.active_routes || snapshot?.map?.active_routes || [])]
    .filter((route) => route?.from && route?.to)
    .sort(liveRouteSort)
    .slice(0, 5);
  if (activeRoutes.length) {
    return {
      mode: 'LIVE',
      label: `实时线路 ${activeRoutes.length} 条`,
      disclaimer: '经纬度估算路线，不代表道路导航。',
      routes: activeRoutes.map((route, index) => ({
        key: route.route_key || `live-${index + 1}`,
        routeNo: String(index + 1).padStart(2, '0'),
        mode: 'LIVE',
        destinationType: route.to?.channel === 'THIRD_SPACE' ? 'THIRD_SPACE' : 'TRADITIONAL_STORE',
        name: `${route.vehicle_label || '配送车辆'} → ${route.to?.display_name || '运输目标点'}`,
        coordinates: [[Number(route.from.longitude), Number(route.from.latitude)], [Number(route.to.longitude), Number(route.to.latitude)]],
        live: route,
      })).filter((route) => route.coordinates.flat().every(Number.isFinite)),
    };
  }
  if (!localShowcaseRoutesAreValid(showcaseCatalog)) return { mode: 'EMPTY', label: '当前无可展示线路', disclaimer: '经纬度估算路线，不代表道路导航。', routes: [] };
  return {
    mode: 'SHOWCASE',
    label: '预设路线演示 · 非实时车辆',
    disclaimer: showcaseCatalog.disclaimer,
    routes: showcaseCatalog.routes.map((route) => ({
      key: `showcase-${route.route_no}`,
      routeNo: route.route_no,
      mode: 'SHOWCASE',
      destinationType: route.destination_type,
      name: `${showcaseCatalog.origin.display_name} → ${route.destination_name}`,
      coordinates: route.coordinates,
      showcase: { ...route, origin: showcaseCatalog.origin },
    })),
  };
}

function showcaseRouteTooltip(route) {
  const data = route.showcase;
  return `路线 ${route.routeNo} · 展示车辆<br/>${data.origin.display_name} → ${data.destination_name}<br/>估算距离：${data.estimated_distance_km} km<br/>预设路线演示 · 无实时定位与遥测<br/>不代表道路导航或实时履约`;
}

const BASEMAP_SERIES_IDS = Object.freeze({
  motorway: 'basemap-motorway', trunk: 'basemap-trunk', primary: 'basemap-primary',
  secondary: 'basemap-secondary', tertiary: 'basemap-tertiary', railway: 'basemap-railway',
  waterway: 'basemap-water', district_boundary: 'basemap-districts',
});

function mapDetailLevel(zoom) {
  if (zoom >= 2.6) return 3;
  if (zoom >= 1.6) return 2;
  return 1;
}

function layerVisible(layer, detailLevel) {
  if (layer === 'secondary') return detailLevel >= 2;
  if (layer === 'tertiary') return detailLevel >= 3;
  return true;
}

function basemapSeries(basemap, colors, zoom = 1) {
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
  const placeLabels = [];
  const roadLabels = [];
  const detailRoadLabels = [];
  const detailLevel = mapDetailLevel(zoom);
  for (const feature of basemap.features) {
    const layer = feature?.properties?.layer;
    const geometry = feature?.geometry;
    if (layer === 'place_label' && geometry?.type === 'Point') {
      placeLabels.push({ name: feature.properties.name, value: geometry.coordinates });
      continue;
    }
    if (layer === 'road_label' && geometry?.type === 'Point') {
      const target = Number(feature.properties.detail_level || 2) >= 3 ? detailRoadLabels : roadLabels;
      target.push({ name: feature.properties.name, value: geometry.coordinates });
      continue;
    }
    if (!['LineString', 'MultiLineString'].includes(geometry?.type) || !layerStyles[layer]) continue;
    if (!groups.has(layer)) groups.set(layer, []);
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    for (const coordinates of lines) groups.get(layer).push({ name: feature.properties.name || '', coords: coordinates });
  }
  const names = { motorway: '高速与快速路', trunk: '国省干线', primary: '城市主干路', secondary: '城市次干路', tertiary: '连接道路', railway: '铁路', waterway: '主要水系', district_boundary: '片区边界' };
  const result = [...groups].map(([layer, data], index) => ({
    id: BASEMAP_SERIES_IDS[layer], name: names[layer], type: 'lines', polyline: true, coordinateSystem: 'geo', z: index + 1, silent: true,
    animation: false,
    lineStyle: { curveness: 0, ...layerStyles[layer], opacity: layerVisible(layer, detailLevel) ? layerStyles[layer].opacity ?? 1 : 0 }, data,
  }));
  if (placeLabels.length) result.push({
    id: 'basemap-place-labels', name: '长春片区标签', type: 'scatter', coordinateSystem: 'geo', zlevel: 1, silent: true,
    symbolSize: 2, itemStyle: { color: 'transparent' },
    label: { show: true, formatter: '{b}', position: 'top', color: colors.mapPlaceLabel, fontSize: 9, textBorderColor: colors.mapTextBorder, textBorderWidth: 2 },
    labelLayout: { hideOverlap: true }, data: placeLabels,
  });
  if (roadLabels.length) result.push({
    id: 'basemap-road-labels', name: '主要道路名称', type: 'scatter', coordinateSystem: 'geo', zlevel: 2, silent: true,
    symbolSize: 1, itemStyle: { color: 'transparent' },
    label: { show: detailLevel >= 2, formatter: '{b}', position: 'top', color: colors.mapRoadLabel, fontSize: 8, textBorderColor: colors.mapTextBorder, textBorderWidth: 2 },
    labelLayout: { hideOverlap: true }, data: roadLabels,
  });
  if (detailRoadLabels.length) result.push({
    id: 'basemap-road-labels-detail', name: '路线周边道路名称', type: 'scatter', coordinateSystem: 'geo', zlevel: 2, silent: true,
    symbolSize: 1, itemStyle: { color: 'transparent' },
    label: { show: detailLevel >= 3, formatter: '{b}', position: 'top', color: colors.mapRoadLabel, fontSize: 8.5, textBorderColor: colors.mapTextBorder, textBorderWidth: 2 },
    labelLayout: { hideOverlap: true }, data: detailRoadLabels,
  });
  return result;
}

export function basemapVisibilityPatch(zoom = 1) {
  const detailLevel = mapDetailLevel(zoom);
  return [
    { id: BASEMAP_SERIES_IDS.secondary, lineStyle: { opacity: detailLevel >= 2 ? 1 : 0 } },
    { id: BASEMAP_SERIES_IDS.tertiary, lineStyle: { opacity: detailLevel >= 3 ? 0.72 : 0 } },
    { id: 'basemap-road-labels', label: { show: detailLevel >= 2 } },
    { id: 'basemap-road-labels-detail', label: { show: detailLevel >= 3 } },
  ];
}

function routeColor(route, colors) {
  const index = Math.max(0, Math.min(4, Number.parseInt(route.routeNo, 10) - 1));
  return colors.routeColors?.[index] || (route.destinationType === 'THIRD_SPACE' ? colors.thirdSpace : colors.traditional);
}

function routeCoordinates(route, selectedKey, overview) {
  const branchIndex = Number(route.showcase?.branch_start_index);
  if (route.mode === 'SHOWCASE' && Number.isInteger(branchIndex) && branchIndex > 0 && overview) {
    return route.coordinates.slice(branchIndex);
  }
  if (route.mode === 'SHOWCASE' && Number.isInteger(branchIndex) && branchIndex > 0 && selectedKey && route.key !== selectedKey) {
    return route.coordinates.slice(branchIndex);
  }
  return route.coordinates;
}

export function buildChangchunMapOption(snapshot, palette = SCREEN_PALETTES.night, basemap = null, showcaseCatalog = null, displayOptions = {}) {
  const colors = { ...SCREEN_PALETTES.night, ...palette };
  const publicMap = snapshot.public_map || snapshot.map || {};
  const routePresentation = selectChangchunRoutes(snapshot, showcaseCatalog);
  const selectedKey = displayOptions.selectedRouteKey || null;
  const viewport = normalizeMapViewport(displayOptions.viewport || { zoom: 1, center: null, selectedRouteKey: selectedKey });
  const overview = !selectedKey;
  const reducedMotion = displayOptions.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const points = (publicMap.points || []).map((point) => ({
    name: point.display_name,
    value: [Number(point.longitude), Number(point.latitude)],
    point,
    symbolSize: point.point_type === 'THIRD_SPACE' ? 13 : 9,
    itemStyle: {
      color: point.point_type === 'THIRD_SPACE' ? colors.thirdSpace : colors.traditional,
      opacity: selectedKey && point.display_name !== routePresentation.routes.find((route) => route.key === selectedKey)?.showcase?.destination_name ? 0.28 : 1,
    },
  })).filter((point) => point.value.every(Number.isFinite));
  const routes = routePresentation.routes.map((route) => {
    const selected = route.key === selectedKey;
    const coordinates = routeCoordinates(route, selectedKey, overview);
    return {
      name: route.name,
      coords: coordinates,
      routeDisplay: route,
      lineStyle: {
        color: routeColor(route, colors),
        type: route.mode === 'LIVE' && (route.live.latest_location?.freshness === 'DELAYED' || route.live.fallback) ? 'dashed' : 'solid',
        width: overview ? 2.2 : selected ? 4.5 : 1,
        opacity: overview ? 0.72 : selected ? 1 : 0.12,
      },
    };
  });
  const movingRoutes = reducedMotion ? [] : routes.filter((route) => overview || route.routeDisplay.key === selectedKey);
  const sharedCoordinates = routePresentation.mode === 'SHOWCASE' && overview && Array.isArray(showcaseCatalog?.shared_corridor)
    ? showcaseCatalog.shared_corridor : [];
  const endpoints = routes.map((route) => ({
    name: `路线 ${route.routeDisplay.routeNo}`,
    value: route.coords.at(-1),
    routeDisplay: route.routeDisplay,
    itemStyle: { color: routeColor(route.routeDisplay, colors), opacity: overview || route.routeDisplay.key === selectedKey ? 1 : 0.2 },
  }));
  const alerts = routes.filter((item) => item.routeDisplay.mode === 'LIVE' && Number(item.routeDisplay.live.alert_count || item.routeDisplay.live.alerts?.length || 0) > 0).map((item) => ({
    name: `${item.routeDisplay.live.to?.display_name || '运输目标点'}报警`,
    value: item.coords.at(-1),
    routeDisplay: item.routeDisplay,
  }));
  return {
    animation: false,
    animationDurationUpdate: 0,
    tooltip: {
      trigger: 'item',
      backgroundColor: colors.tooltipBackground,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.text },
      formatter(params) {
        if (params.seriesName === '精选点位') return publicPointTooltip(params.data.point);
        if (['配送展示路线', '路线流动车辆', '路线终点标识'].includes(params.seriesName)) return params.data.routeDisplay.mode === 'SHOWCASE'
          ? showcaseRouteTooltip(params.data.routeDisplay)
          : publicRouteTooltip(params.data.routeDisplay.live);
        if (params.seriesName === '独立温湿度报警') return publicRouteTooltip(params.data.routeDisplay.live);
        return params.name || '';
      },
    },
    geo: {
      map: 'changchun-service-area',
      roam: true,
      center: viewport.center || undefined,
      zoom: viewport.zoom,
      scaleLimit: MAP_SCALE_LIMIT,
      layoutCenter: ['50%', '51%'],
      layoutSize: '97%',
      label: { show: false },
      itemStyle: { areaColor: colors.mapArea, borderColor: colors.mapBorder, borderWidth: 1.2, shadowColor: colors.mapShadow, shadowBlur: 16 },
      emphasis: { itemStyle: { areaColor: colors.mapEmphasis } },
    },
    series: [
      ...basemapSeries(basemap, colors, viewport.zoom),
      {
        id: 'shared-route-corridor', name: '园区共同配送干线', type: 'lines', polyline: true, coordinateSystem: 'geo', z: 18, silent: true,
        lineStyle: { color: colors.mapSharedRoute, width: 3, opacity: sharedCoordinates.length ? 0.78 : 0, curveness: 0 },
        data: sharedCoordinates.length ? [{ name: '园区共同配送干线', coords: sharedCoordinates }] : [],
      },
      {
        id: 'delivery-routes', name: '配送展示路线', type: 'lines', polyline: true, coordinateSystem: 'geo', z: 20,
        lineStyle: { curveness: 0 }, data: routes,
      },
      {
        id: 'route-vehicles', name: '路线流动车辆', type: 'lines', polyline: true, coordinateSystem: 'geo', z: 25, silent: false,
        effect: { show: !reducedMotion && movingRoutes.length > 0, period: 9, trailLength: 0, symbol: 'arrow', symbolSize: 7, color: colors.mapEffect },
        lineStyle: { width: 0, opacity: 0, curveness: 0 }, data: movingRoutes,
      },
      {
        id: 'business-points', name: '精选点位', type: 'scatter', coordinateSystem: 'geo', z: 30,
        label: { show: viewport.zoom >= 1.25 || overview, formatter: '{b}', position: 'right', distance: 6, color: colors.text, fontSize: 10, textBorderColor: colors.mapTextBorder, textBorderWidth: 3 },
        labelLayout: { hideOverlap: true },
        data: points,
      },
      {
        id: 'route-endpoints', name: '路线终点标识', type: 'scatter', coordinateSystem: 'geo', z: 34, symbol: 'pin', symbolSize: 18,
        label: { show: true, formatter: (params) => params.data.routeDisplay.routeNo, position: 'inside', color: colors.mapTextBorder, fontSize: 8, fontWeight: 700 },
        labelLayout: { hideOverlap: true }, data: endpoints,
      },
      {
        id: 'route-alerts', name: '独立温湿度报警', type: 'effectScatter', coordinateSystem: 'geo', z: 40,
        symbolSize: 19, rippleEffect: { scale: 3.5, brushType: 'stroke' },
        itemStyle: { color: colors.danger }, data: alerts,
      },
    ],
  };
}
