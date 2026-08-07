import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';

const projectRoot = new URL('../../', import.meta.url);

test('演示快照的顶部总量等于两个渠道并按单位核对', async () => {
  const payload = JSON.parse(await readFile(new URL('frontend-mocks-v0.1/e02-dashboard-snapshot.json', projectRoot), 'utf8'));
  const data = payload.data;
  assert.equal(data.headline.preorder_count, data.channel_mix.reduce((sum, item) => sum + item.preorder_count, 0));
  assert.equal(data.headline.operation_order_count, data.channel_mix.reduce((sum, item) => sum + item.operation_order_count, 0));
  for (const total of data.headline.demand_totals) {
    const channelTotal = data.channel_mix.reduce((sum, channel) => sum + (channel.demand_totals.find((item) => item.unit === total.unit)?.quantity || 0), 0);
    assert.equal(total.quantity, channelTotal);
  }
});

test('E02 只有麦克风入口和两个经营占比环图', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  assert.match(html, /id="dv2-order-donut"/);
  assert.match(html, /id="dv2-sales-donut"/);
  assert.match(html, /id="dv2-mic-button"/);
  assert.doesNotMatch(html, /id="public-assistant-input"/);
});

test('生产构建包含本地地图、背景和 ECharts 且不含外部依赖地址', async () => {
  const paths = [
    'dist/assets/maps/northeast-china-admin1.geojson',
    'dist/assets/backgrounds/northeast-winter-corn-v1.webp',
    'dist/vendor/echarts/echarts.min.js',
  ];
  for (const path of paths) assert.ok((await stat(new URL(path, projectRoot))).size > 100);
  const textFiles = ['dist/index.html', 'dist/api.js', 'dist/scripts.js', 'dist/dashboard-v2.js', 'dist/dashboard.css'];
  const source = (await Promise.all(textFiles.map((path) => readFile(new URL(path, projectRoot), 'utf8')))).join('\n').toLowerCase();
  for (const banned of ['localhost', 'openstreetmap', 'fonts.googleapis', 'cdnjs', 'unpkg.com', 'jsdelivr']) assert.equal(source.includes(banned), false, `found banned marker: ${banned}`);
});

test('生产构建强制真实 API 且不携带 Mock 数据', async () => {
  const runtime = await readFile(new URL('dist/runtime-config.js', projectRoot), 'utf8');
  assert.match(runtime, /api\.flexibility607\.cn\/api\/v1/);
  assert.match(runtime, /demo: false/);
  await assert.rejects(access(new URL('dist/frontend-mocks-v0.1', projectRoot)));
  const html = await readFile(new URL('dist/index.html', projectRoot), 'utf8');
  assert.doesNotMatch(html, /id="toggle-mock"/);
  for (const label of ['DEMAND BY UNIT', 'CHANNEL MIX', 'VOICE DATA AGENT']) assert.equal(html.includes(label), false);
});
