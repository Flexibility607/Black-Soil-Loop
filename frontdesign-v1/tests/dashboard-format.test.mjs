import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelValues,
  dashboardPalette,
  demandDisplaySummary,
  demandSeries,
  formatCurrency,
  formatCnyAmount,
  formatUnit,
  SCREEN_PALETTES,
} from '../dashboard-format.js';

test('需求趋势保持单位拆分，不把公斤与件相加', () => {
  const result = demandSeries([
    { date: '2026-08-01', channel_type: 'TRADITIONAL_STORE', demand_totals: [{ unit: 'kg', quantity: 10 }, { unit: '件', quantity: 3 }] },
    { date: '2026-08-01', channel_type: 'THIRD_SPACE', demand_totals: [{ unit: 'kg', quantity: 4 }, { unit: '件', quantity: 2 }] },
  ]);
  assert.deepEqual(result.dates, ['2026-08-01']);
  assert.deepEqual(Object.fromEntries(result.series.map((item) => [item.name, item.data])), { 公斤: [14], 件: [5] });
});

test('大屏统一中文单位与人民币格式', () => {
  assert.equal(formatUnit('kg'), '公斤');
  assert.equal(formatUnit('m3'), '立方米');
  assert.equal(formatCurrency(12345), '1.23 万元');
  assert.equal(formatCnyAmount(null), '—');
  assert.equal(formatCnyAmount(''), '—');
  assert.equal(formatCnyAmount(Number.NaN), '—');
  assert.equal(formatCnyAmount(Number.POSITIVE_INFINITY), '—');
  assert.equal(formatCnyAmount(-1), '—');
  assert.equal(formatCnyAmount(-0), '0 元');
  assert.equal(formatCnyAmount(0), '0 元');
  assert.equal(formatCnyAmount(9999.99), '9,999.99 元');
  assert.equal(formatCnyAmount(10000), '1 万元');
  assert.equal(formatCnyAmount(100000000), '1 亿元');
  assert.equal(formatCnyAmount(283744.6, { compact: false, fullPrecision: true }), '283,744.60 元');
});

test('需求 KPI 固定以公斤为主单位并保持其他单位独立', () => {
  const summary = demandDisplaySummary([
    { unit: 'kg', quantity: 0 },
    { unit: 'kilograms', quantity: 10.25 },
    { unit: '箱', quantity: 9999 },
    { unit: '件', quantity: Number.NaN },
    { unit: '袋', quantity: -1 },
    { unit: '托', quantity: 2 },
  ]);
  assert.deepEqual(summary.primary, { unit: '公斤', quantity: 10.25, available: true });
  assert.deepEqual(summary.all, [
    { unit: '公斤', quantity: 10.25 },
    { unit: '箱', quantity: 9999 },
    { unit: '托', quantity: 2 },
  ]);
  assert.equal(summary.secondaryCount, 2);
});

test('公斤缺失时不自动替换主单位，零值仍然有效', () => {
  assert.deepEqual(demandDisplaySummary([{ unit: '箱', quantity: 12 }]).primary, { unit: '公斤', quantity: null, available: false });
  assert.deepEqual(demandDisplaySummary([{ unit: 'kg', quantity: 0 }]).primary, { unit: '公斤', quantity: 0, available: true });
  assert.deepEqual(demandDisplaySummary([null, { unit: 'kg', quantity: null }, { unit: '件', quantity: Infinity }]).all, []);
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
