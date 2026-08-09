import { SCREEN_PALETTES } from './dashboard-format.js?v=20260809-jipin-theme-1';

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

function nodeColor(type, palette) {
  if (type === 'PARK') return palette.demand;
  if (type === 'THIRD_SPACE') return palette.thirdSpace;
  return palette.traditional;
}

function statusLabel(status) {
  return {
    DRAFT: '草稿', MATCHED: '已匹配', CONFIRMED: '已确认', PUBLISHED: '已发布', DRIVER_ACCEPTED: '司机已接单',
    PICKED_UP: '已取货', IN_TRANSIT: '运输中', DELIVERED: '已送达', STORE_SIGNED: '门店已签收',
    COMPLETED: '已完成', CANCELLED: '已取消',
  }[status] || '状态待同步';
}

export function buildNortheastMapOption(snapshot, palette = SCREEN_PALETTES.night) {
  const colors = { ...SCREEN_PALETTES.night, ...palette };
  const nodeById = new Map((snapshot.map_nodes || []).map((node) => [node.node_id, node]));
  const lines = (snapshot.map_edges || []).map((edge) => {
    const source = nodeById.get(edge.source_id);
    const target = nodeById.get(edge.target_id);
    if (!source || !target) return null;
    return {
      name: `${edge.task_no || edge.task_id || '运输任务'} · ${edge.route_label || '经纬度估算路线'}`,
      coords: [[Number(source.longitude), Number(source.latitude)], [Number(target.longitude), Number(target.latitude)]],
      taskStatus: edge.status,
      telemetry: edge.latest_telemetry,
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
          const environmental = telemetry
            ? `<br/>温度 ${telemetry.temperature_c ?? '—'} ℃ · 湿度 ${telemetry.humidity_pct ?? '—'}%<br/>采样 ${telemetry.sampled_at || '—'}`
            : '<br/>暂无温湿度采样';
          return `${params.name}<br/>状态：${status}${environmental}`;
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
