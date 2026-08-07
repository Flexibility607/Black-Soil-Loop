import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptDashboardSnapshot } from '../dashboard-adapter.js';

test('新服务器快照保留日期、渠道和原始需求单位', () => {
  const snapshot = adaptDashboardSnapshot({
    generated_at: '2026-08-06T08:00:00+08:00',
    data_cutoff: '2026-08-06T07:59:00+08:00',
    summary: { preorder_count: 2, operation_order_count: 5, total_sales_amount: 300, store_count: 2 },
    charts: {
      daily_demand_by_unit: [
        { date: '2026-08-06', channel: 'TRADITIONAL', unit: 'kg', quantity: 100 },
        { date: '2026-08-06', channel: 'THIRD_SPACE', unit: '箱', quantity: 12 },
      ],
      daily_operations_by_channel: [
        { date: '2026-08-06', channel: 'TRADITIONAL', order_count: 3, sales_amount: 200 },
        { date: '2026-08-06', channel: 'THIRD_SPACE', order_count: 2, sales_amount: 100 },
      ],
      daily_preorders_by_channel: [
        { date: '2026-08-06', channel: 'TRADITIONAL', count: 1 },
        { date: '2026-08-06', channel: 'THIRD_SPACE', count: 1 },
      ],
      preorders_by_channel: [{ channel: 'TRADITIONAL', count: 1 }, { channel: 'THIRD_SPACE', count: 1 }],
      channel_mix: [
        { channel: 'TRADITIONAL', order_count: 3, sales_amount: 200 },
        { channel: 'THIRD_SPACE', order_count: 2, sales_amount: 100 },
      ],
      third_space_ranking: [], demand_by_enterprise: [], inventory_by_product: [], warehouse_capacity: [], transport_status: [],
    },
    map: { stores: [], routes: [] },
    data_quality: { store_count: 2, reporting_store_count: 2, report_coverage_pct: 100 },
    alerts: [],
  });
  assert.deepEqual(snapshot.headline.demand_totals, [{ unit: 'kg', quantity: 100 }, { unit: '箱', quantity: 12 }]);
  assert.equal(snapshot.daily_trend.length, 2);
  assert.ok(Math.abs(snapshot.channel_mix.find((row) => row.channel_type === 'THIRD_SPACE').sales_share - 100 / 3) < 1e-9);
});

test('真实任务生成估算路线并携带温湿度异常', () => {
  const snapshot = adaptDashboardSnapshot({
    summary: {}, charts: {}, data_quality: {}, alerts: [],
    map: {
      stores: [{ id: 's1', name: '第三空间一店', channel: 'THIRD_SPACE', latitude: 43.8, longitude: 125.3 }],
      routes: [{
        task_id: 't1', task_no: '任务一', status: 'IN_TRANSIT',
        origin: { latitude: 43.9, longitude: 125.2 },
        stops: [{ store_id: 's1', latitude: 43.8, longitude: 125.3 }],
        latest_telemetry: { temperature_c: 12, humidity_pct: 86, anomaly_code: 'HIGH_TEMPERATURE' },
        route_label: '经纬度估算路线',
      }],
    },
  });
  assert.equal(snapshot.map_edges[0].route_label, '经纬度估算路线');
  assert.equal(snapshot.map_edges[0].abnormal, true);
  assert.equal(snapshot.map_nodes.find((node) => node.node_id === 'store-s1').node_type, 'THIRD_SPACE');
});
