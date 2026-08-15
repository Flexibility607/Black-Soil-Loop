import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptDashboardSnapshot } from '../dashboard-adapter.js';

const root = new URL('../../', import.meta.url);

test('固定案例元数据通过适配器且 E02 只保留一个全局标识', async () => {
  const adapted = adaptDashboardSnapshot({
    period: '7d',
    dataset_mode: 'showcase',
    dataset_label: '固定演示案例',
    case_version: '2026-08-15.1',
    case_revision: 12,
    case_refreshed_at: '2026-08-15T03:05:00+08:00',
    summary: {}, charts: {}, map: { schema_version: '2.0', points: [], active_routes: [] },
  });
  assert.equal(adapted.dataset_mode, 'showcase');
  assert.equal(adapted.case_revision, 12);
  assert.equal(adapted.case_refreshed_at, '2026-08-15T03:05:00+08:00');

  const html = await readFile(new URL('frontdesign-v1/index.html', root), 'utf8');
  assert.equal((html.match(/id="dv2-demo-badge"/g) || []).length, 1);
  assert.equal((html.match(/id="e01-dataset-badge"/g) || []).length, 1);
  assert.equal((html.match(/id="showcase-data-dialog"/g) || []).length, 1);
  assert.equal((html.match(/数据为系统固定演示数据。/g) || []).length, 1);
  assert.equal((html.match(/日期每日滚动。/g) || []).length, 1);
  assert.equal((html.match(/数据不进入真实经营统计。/g) || []).length, 1);
  assert.match(html, /id="e01-data-info"[^>]*hidden/);
  assert.match(html, /id="dv2-data-info"[^>]*hidden/);
  assert.match(html, /id="reset-demo-case"[^>]*hidden/);
});

test('演示数据集由签名会话决定且恢复后前端清空会话', async () => {
  const api = await readFile(new URL('frontdesign-v1/api.js', root), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', root), 'utf8');
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', root), 'utf8');
  assert.match(api, /dataset_mode: payload\.dataset_mode/);
  assert.match(api, /\/web\/demo-case\/reset/);
  assert.match(api, /clearSession\('showcase_reset'\)/);
  assert.match(api, /expected_case_revision: expectedCaseRevision/);
  assert.match(scripts, /固定案例正在恢复/);
  assert.match(dashboard, /snapshot\.dataset_mode === 'showcase'/);
  assert.match(dashboard, /固定演示案例 · 更新至/);
  assert.doesNotMatch(api, /[?&]dataset=/);
});
