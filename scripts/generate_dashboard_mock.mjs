import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(projectRoot, 'frontend-mocks-v0.1', 'e02-dashboard-snapshot.json');
const days = 30;
const start = new Date('2026-07-06T00:00:00+08:00');
const trend = [];

for (let index = 0; index < days; index += 1) {
  const date = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
  const week = index % 7;
  const traditionalOrders = 224 + week * 7 + (index % 3) * 4;
  const thirdOrders = 130 + week * 5 + (index % 4) * 3;
  trend.push({
    date,
    channel_type: 'TRADITIONAL_STORE',
    preorder_count: 8 + (index % 5),
    demand_totals: [
      { unit: 'kg', quantity: 342 + week * 11 },
      { unit: '件', quantity: 73 + (index % 6) * 3 },
    ],
    operation_order_count: traditionalOrders,
    sales_amount: traditionalOrders * (21.4 + (index % 3) * 0.6),
  });
  trend.push({
    date,
    channel_type: 'THIRD_SPACE',
    preorder_count: 4 + (index % 3),
    demand_totals: [
      { unit: 'kg', quantity: 135 + week * 7 },
      { unit: '件', quantity: 34 + (index % 5) * 2 },
    ],
    operation_order_count: thirdOrders,
    sales_amount: thirdOrders * (25.8 + (index % 4) * 0.8),
  });
}

function aggregate(channelType) {
  const rows = trend.filter((row) => row.channel_type === channelType);
  const units = new Map();
  for (const row of rows) {
    for (const item of row.demand_totals) units.set(item.unit, (units.get(item.unit) || 0) + item.quantity);
  }
  return {
    channel_type: channelType,
    display_name: channelType === 'THIRD_SPACE' ? '第三空间' : '传统门店',
    preorder_count: rows.reduce((sum, row) => sum + row.preorder_count, 0),
    demand_totals: [...units].map(([unit, quantity]) => ({ unit, quantity })),
    operation_order_count: rows.reduce((sum, row) => sum + row.operation_order_count, 0),
    sales_amount: Number(rows.reduce((sum, row) => sum + row.sales_amount, 0).toFixed(2)),
  };
}

const channelMix = [aggregate('TRADITIONAL_STORE'), aggregate('THIRD_SPACE')];
const totalOrders = channelMix.reduce((sum, item) => sum + item.operation_order_count, 0);
const totalSales = channelMix.reduce((sum, item) => sum + item.sales_amount, 0);
for (const item of channelMix) {
  item.operation_order_share = Number((item.operation_order_count / totalOrders * 100).toFixed(2));
  item.sales_share = Number((item.sales_amount / totalSales * 100).toFixed(2));
}

const demandTotals = new Map();
for (const channel of channelMix) {
  for (const item of channel.demand_totals) demandTotals.set(item.unit, (demandTotals.get(item.unit) || 0) + item.quantity);
}

const thirdRows = trend.filter((row) => row.channel_type === 'THIRD_SPACE');
const thirdTotalOrders = thirdRows.reduce((sum, row) => sum + row.operation_order_count, 0);
const thirdTotalSales = thirdRows.reduce((sum, row) => sum + row.sales_amount, 0);
const thirdSpaces = [
  { id: 'STORE-DEMO-THIRD-001', name: '有山城市书房【演示】', city: '长春市', longitude: 125.326, latitude: 43.879, orderShare: 0.42, salesShare: 0.45 },
  { id: 'STORE-DEMO-THIRD-002', name: '长春冰雪新天地【演示】', city: '长春市', longitude: 125.506, latitude: 43.816, orderShare: 0.34, salesShare: 0.33 },
  { id: 'STORE-DEMO-THIRD-003', name: '这有山文旅空间【演示】', city: '长春市', longitude: 125.296, latitude: 43.862, orderShare: 0.24, salesShare: 0.22 },
].map((item) => ({
  store_id: item.id,
  store_name: item.name,
  city: item.city,
  longitude: item.longitude,
  latitude: item.latitude,
  preorder_count: Math.round(channelMix[1].preorder_count * item.orderShare),
  demand_totals: channelMix[1].demand_totals.map((total) => ({ unit: total.unit, quantity: Math.round(total.quantity * item.orderShare) })),
  operation_order_count: Math.round(thirdTotalOrders * item.orderShare),
  sales_amount: Number((thirdTotalSales * item.salesShare).toFixed(2)),
  last_report_date: '2026-08-04',
  last_report_status: item.id.endsWith('003') ? 'INCOMPLETE' : 'COMPLETE',
  is_demo: true,
}));

const nodes = [
  { node_id: 'PARK-DEMO-001', node_type: 'PARK', display_name: '长春农安新安食品产业园【演示】', city: '长春市农安县', longitude: 125.182, latitude: 44.432 },
  { node_id: 'STORE-DEMO-TRAD-001', node_type: 'TRADITIONAL_STORE', display_name: '哈尔滨中央大街门店【演示】', city: '哈尔滨市', longitude: 126.618, latitude: 45.759 },
  { node_id: 'STORE-DEMO-TRAD-002', node_type: 'TRADITIONAL_STORE', display_name: '沈阳中街门店【演示】', city: '沈阳市', longitude: 123.461, latitude: 41.803 },
  ...thirdSpaces.map((item) => ({ node_id: item.store_id, node_type: 'THIRD_SPACE', display_name: item.store_name, city: item.city, longitude: item.longitude, latitude: item.latitude })),
];

const snapshot = {
  park_id: 'PARK-DEMO-001',
  park_name: '长春农安新安食品产业园【演示】',
  range_start: '2026-07-06T00:00:00+08:00',
  range_end: '2026-08-05T00:00:00+08:00',
  period: '30d',
  headline: {
    preorder_count: channelMix.reduce((sum, item) => sum + item.preorder_count, 0),
    demand_totals: [...demandTotals].map(([unit, quantity]) => ({ unit, quantity })),
    operation_order_count: totalOrders,
    sales_amount: Number(totalSales.toFixed(2)),
    currency: 'CNY',
  },
  channel_mix: channelMix,
  daily_trend: trend,
  third_spaces: thirdSpaces,
  map_nodes: nodes,
  map_edges: nodes.slice(1).map((node) => ({ source_id: 'PARK-DEMO-001', target_id: node.node_id, channel_type: node.node_type === 'THIRD_SPACE' ? 'THIRD_SPACE' : 'TRADITIONAL_STORE' })),
  data_quality: {
    store_count: 5,
    reporting_store_count: 5,
    missing_store_classification_count: 1,
    missing_coordinate_count: 0,
    missing_report_count: 2,
    report_coverage: 98.7,
    excluded_preorder_count: 3,
    excluded_demand_totals: [{ unit: 'kg', quantity: 96 }],
    expected_report_count: 150,
    received_report_count: 148,
    warnings: ['1 家历史门店缺少渠道分类，相关预订单未计入正式总量。', '2 个门店日报日次缺报。'],
  },
  data_cutoff: '2026-08-04T21:30:00+08:00',
  demo_mode: true,
  internal: {
    capacity: [
      { label: '玉米深加工', value: 82, unit: '%', status: '正常' },
      { label: '淀粉糖产线', value: 76, unit: '%', status: '正常' },
      { label: '预制菜产线', value: 91, unit: '%', status: '偏紧' },
    ],
    inventory_alerts: [
      { label: '玉米淀粉', value: 3, unit: '项', status: '预警' },
      { label: '包装材料', value: 1, unit: '项', status: '关注' },
    ],
    freezer: [
      { label: '一号冻库', value: 78, unit: '%', status: '正常' },
      { label: '二号冻库', value: 64, unit: '%', status: '正常' },
    ],
    transport: [
      { label: '在途', value: 12, unit: '车', status: 'IN_PROGRESS' },
      { label: '待发车', value: 5, unit: '车', status: 'DRAFT' },
      { label: '已完成', value: 38, unit: '车', status: 'COMPLETED' },
      { label: '异常', value: 1, unit: '车', status: 'ALERT' },
    ],
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ status: 'PROCESSED', code: 'OK', data: snapshot, errors: [], trace_id: 'TRACE-DEMO-DASHBOARD-001', data_cutoff: snapshot.data_cutoff }, null, 2)}\n`, 'utf8');
console.log(`Wrote dashboard demo snapshot to ${outputPath}.`);
