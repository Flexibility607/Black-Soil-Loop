import { COLORS } from './dashboard-format.js';

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

function nodeColor(type) {
  if (type === 'PARK') return COLORS.demand;
  if (type === 'THIRD_SPACE') return COLORS.thirdSpace;
  return COLORS.traditional;
}

function statusLabel(status) {
  return {
    DRAFT: '草稿', MATCHED: '已匹配', CONFIRMED: '已确认', PUBLISHED: '已发布', DRIVER_ACCEPTED: '司机已接单',
    PICKED_UP: '已取货', IN_TRANSIT: '运输中', DELIVERED: '已送达', STORE_SIGNED: '门店已签收',
    COMPLETED: '已完成', CANCELLED: '已取消',
  }[status] || '状态待同步';
}

export function buildNortheastMapOption(snapshot) {
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
      lineStyle: { color: edge.abnormal ? '#ff6b68' : edge.channel_type === 'THIRD_SPACE' ? COLORS.thirdSpace : COLORS.traditional },
    };
  }).filter(Boolean);

  const storeNodes = (snapshot.map_nodes || []).map((node) => ({
    name: node.display_name,
    value: [Number(node.longitude), Number(node.latitude), node.node_type],
    itemStyle: { color: nodeColor(node.node_type) },
    symbolSize: node.node_type === 'PARK' ? 19 : node.node_type === 'THIRD_SPACE' ? 12 : 9,
  }));

  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(8, 31, 55, .96)',
      borderColor: COLORS.traditional,
      textStyle: { color: COLORS.text },
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
      label: { show: true, color: '#9ad8ec', fontSize: 13 },
      itemStyle: {
        areaColor: 'rgba(17, 66, 105, .66)',
        borderColor: '#5acbff',
        borderWidth: 1.2,
        shadowColor: 'rgba(39, 177, 232, .35)',
        shadowBlur: 16,
      },
      emphasis: { itemStyle: { areaColor: 'rgba(31, 103, 143, .82)' }, label: { color: '#fff' } },
    },
    series: [
      {
        name: '估算运输路线',
        type: 'lines',
        coordinateSystem: 'geo',
        zlevel: 2,
        silent: false,
        effect: { show: true, period: 6, trailLength: 0.22, symbolSize: 3, color: '#d9fbff' },
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
          color: COLORS.text,
          fontSize: 11,
          textBorderColor: '#071a2d',
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
        itemStyle: { color: '#799dad' },
        label: { show: true, formatter: '{b}', position: 'top', color: '#799dad', fontSize: 10 },
        data: REFERENCE_CITIES,
      },
    ],
  };
}
