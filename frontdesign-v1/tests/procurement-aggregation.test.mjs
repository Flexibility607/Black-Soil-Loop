import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../../', import.meta.url);

test('采购入口默认调用多企业自动汇总并保留人工确认接口', async () => {
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  assert.match(api, /\/web\/procurement\/aggregations\/generate/);
  assert.match(api, /\/web\/procurement\/aggregations\/\$\{encodeURIComponent\(aggregationId\)\}\/confirm/);
  assert.match(scripts, /generateProcurementAggregation\(null/);
  assert.match(scripts, /automatic_quantity/);
  assert.match(scripts, /网页授权用户调整采购汇总数量/);
});

test('采购汇总看板显示周期、单位告警和供应商条形比较', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  const styles = await readFile(new URL('frontdesign-v1/styles.css', projectRoot), 'utf8');
  assert.match(html, /id="procurement-aggregation-board"/);
  assert.match(html, /id="confirm-procurement"/);
  assert.match(scripts, /unit_conversion_warnings/);
  assert.match(scripts, /供应商方案综合评分条形图/);
  assert.match(styles, /\.supplier-compare-bars/);
  assert.match(styles, /--supplier-score/);
});
