import test from 'node:test';
import assert from 'node:assert/strict';
import { channelValues, dashboardPalette, demandSeries, SCREEN_PALETTES } from '../dashboard-format.js';

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

test('大屏日夜色板使用不同的文字和地图颜色，非法主题回退夜间', () => {
  assert.notEqual(dashboardPalette('day').text, dashboardPalette('night').text);
  assert.notEqual(dashboardPalette('day').mapArea, dashboardPalette('night').mapArea);
  assert.equal(dashboardPalette('invalid'), SCREEN_PALETTES.night);
});

test('渠道环图接受主题色板且不改变统计值', () => {
  const values = channelValues([{ channel_type: 'THIRD_SPACE', sales_amount: 12 }], 'sales_amount', SCREEN_PALETTES.day);
  assert.equal(values[1].value, 12);
  assert.equal(values[1].itemStyle.color, SCREEN_PALETTES.day.thirdSpace);
});
