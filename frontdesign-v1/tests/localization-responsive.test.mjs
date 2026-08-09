import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../', import.meta.url);

test('服务器词典驱动中文枚举且未知值有明确兜底', async () => {
  const [api, scripts, adapter] = await Promise.all([
    readFile(new URL('api.js', base), 'utf8'),
    readFile(new URL('scripts.js', base), 'utf8'),
    readFile(new URL('dashboard-adapter.js', base), 'utf8'),
  ]);
  assert.match(api, /\/public\/dictionaries/);
  assert.match(api, /\/web\/dictionaries/);
  assert.match(scripts, /loadServerDictionaries/);
  assert.match(scripts, /未知类型（\$\{value\}）/);
  assert.match(adapter, /applyDashboardDictionaries/);
});

test('用户界面不提供原始 JSON 调试内容并统一常用单位', async () => {
  const scripts = await readFile(new URL('scripts.js', base), 'utf8');
  assert.doesNotMatch(scripts, /查看原始数据（调试）/);
  assert.doesNotMatch(scripts, /JSON\.stringify\(data, null, 2\)/);
  for (const unit of ['公斤', '立方米', '℃', '百分比', '人民币']) assert.match(scripts, new RegExp(unit));
  assert.match(scripts, /未识别字段/);
});

test('模块编号同时显示中文业务名称', async () => {
  const html = await readFile(new URL('index.html', base), 'utf8');
  for (const label of [
    'B01 网页管理与经营服务',
    'B02 移动履约与设备服务',
    'E01 园区管理台',
    'E02 公开产销协同大屏',
  ]) assert.match(html, new RegExp(label));
});

test('E01 精简头部和侧栏辅助文字', async () => {
  const html = await readFile(new URL('index.html', base), 'utf8');
  assert.doesNotMatch(html, /<div class="scope-note">/);
  assert.doesNotMatch(html, /<p class="subtitle">/);
  assert.match(html, /data-section="analytics">B01 网页管理服务<\/button>/);
});

test('E01 在 320 至 1920 像素范围具备横向溢出保护', async () => {
  const [styles, dashboard] = await Promise.all([
    readFile(new URL('styles.css', base), 'utf8'),
    readFile(new URL('dashboard.css', base), 'utf8'),
  ]);
  assert.match(styles, /overflow-x:\s*clip/);
  assert.match(styles, /@media \(max-width:\s*380px\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.table-scroll[^}]*max-width:\s*100%/s);
  assert.match(dashboard, /\.e01-pager[^}]*width:\s*100%/s);
});
