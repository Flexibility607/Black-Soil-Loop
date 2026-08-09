import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../../', import.meta.url);

test('E01 拼仓业务接入确认、查询、占用、取消和释放接口', async () => {
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  for (const marker of [
    '/web/algorithms/warehouse-pool/runs/',
    '/web/warehouse-pool/plans/',
    'confirmWarehousePool',
    'requestWarehousePoolAction',
  ]) assert.match(api, new RegExp(marker.replaceAll('/', '\\/')));
  for (const action of ['occupy', 'cancel', 'release']) {
    assert.match(scripts, new RegExp(`requestWarehouseAction\\('${action}'\\)`));
  }
});

test('拼仓页面显示完整生命周期操作并保存服务器对象版本', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  for (const id of [
    'confirm-warehouse',
    'refresh-warehouse-plan',
    'occupy-warehouse',
    'cancel-warehouse',
    'release-warehouse',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(scripts, /warehouse_object_version/);
  assert.match(scripts, /plan\.object_version/);
  assert.match(scripts, /candidate_warehouses\?\.find\(\(item\) => item\.eligible\)/);
});
