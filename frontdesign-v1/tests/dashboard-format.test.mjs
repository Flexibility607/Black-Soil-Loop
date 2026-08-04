import test from 'node:test';
import assert from 'node:assert/strict';
import { channelValues, demandSeries } from '../dashboard-format.js';

test('需求趋势保持单位拆分，不把公斤与件相加', () => {
  const result = demandSeries([
    { date: '2026-08-01', channel_type: 'TRADITIONAL_STORE', demand_totals: [{ unit: 'kg', quantity: 10 }, { unit: '件', quantity: 3 }] },
    { date: '2026-08-01', channel_type: 'THIRD_SPACE', demand_totals: [{ unit: 'kg', quantity: 4 }, { unit: '件', quantity: 2 }] },
  ]);
  assert.deepEqual(result.dates, ['2026-08-01']);
  assert.deepEqual(Object.fromEntries(result.series.map((item) => [item.name, item.data])), { kg: [14], 件: [5] });
});

test('零分母的渠道环图保持两个渠道和零值', () => {
  assert.deepEqual(channelValues([], 'sales_amount').map((item) => [item.name, item.value]), [['传统门店', 0], ['第三空间', 0]]);
});
