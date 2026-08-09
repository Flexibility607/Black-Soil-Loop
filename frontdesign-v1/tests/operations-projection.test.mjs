import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../../', import.meta.url);

test('E01 接入签收、库存流水、缺货和经营日报投影接口', async () => {
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  for (const route of [
    '/web/receipts',
    '/web/inventory-movements',
    '/web/stockout-demands',
    '/web/store-daily-reports',
    '/web/operations/summary',
  ]) {
    assert.match(api, new RegExp(route.replaceAll('/', '\\/')));
  }
});

test('经营图表均提供周期、单位、数据时间、空态和错误态', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  for (const kind of ['receipt', 'stockout', 'third-space', 'inventory']) {
    assert.match(html, new RegExp(`id="operations-${kind}-chart"`));
    assert.match(html, new RegExp(`id="operations-${kind}-meta"`));
    assert.match(html, new RegExp(`id="operations-${kind}-state"`));
  }
  assert.match(html, /id="operations-timestamps"/);
  assert.match(scripts, /响应生成时间/);
  assert.match(scripts, /业务数据截止/);
  assert.match(scripts, /当前统计周期暂无签收数据/);
  assert.match(scripts, /setOperationState\(kind, message, true\)/);
});
