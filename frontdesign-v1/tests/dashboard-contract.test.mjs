import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  assert.match(html, /id="public-theme-toggle"/);
  assert.match(html, /id="dv2-brand-logo"/);
  assert.match(html, /data-day-src="assets\/brand\/jipin-screen-light-d0308f92\.jpg"/);
  assert.match(html, /data-night-src="assets\/brand\/jipin-screen-dark-e041ecf5\.jpg"/);
  assert.match(html, /assets\/brand\/jipin-web-green-e90c36ef\.jpg/);
  assert.doesNotMatch(html, /jipin-logo\.jpg|吉品临时图标/);
  assert.match(html, /id="dv2-order-donut"/);
  assert.match(html, /id="dv2-sales-donut"/);
  assert.match(html, /id="dv2-mic-button"/);
  assert.doesNotMatch(html, /id="public-assistant-input"/);
});

test('三张吉品 Logo 在源码和构建产物中保持原始字节', async () => {
  const assets = {
    'jipin-screen-light-d0308f92.jpg': 'D0308F92B54FCFCB783886704A7A1E85B1853B724784FB89BC0E9A79425211F8',
    'jipin-web-green-e90c36ef.jpg': 'E90C36EF7F198C1C1E4EE2FCDD517C09B71842D11CD1AF2764F27AED1EB131FE',
    'jipin-screen-dark-e041ecf5.jpg': 'E041ECF5C6ADD12F257F3CC07F862BE9B8DA9797477362C6C22EAA53709B069F',
  };
  for (const [name, expected] of Object.entries(assets)) {
    for (const prefix of ['frontdesign-v1/assets/brand', 'dist/assets/brand']) {
      const bytes = await readFile(new URL(`${prefix}/${name}`, projectRoot));
      assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), expected);
    }
  }
});

test('大屏主题恢复、Logo 切换和图表重绘不触发数据刷新', async () => {
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  const css = await readFile(new URL('frontdesign-v1/dashboard.css', projectRoot), 'utf8');
  assert.match(scripts, /readStoredPublicTheme\(\)/);
  assert.match(scripts, /theme === 'day' \? 'day' : 'night'/);
  assert.match(scripts, /app:public-theme-change/);
  assert.match(scripts, /dataset\.daySrc/);
  assert.match(css, /body\.screen-mode\.screen-day \.dashboard-v2/);
  assert.match(dashboard, /window\.addEventListener\('app:public-theme-change'/);
  const themeBlock = dashboard.slice(dashboard.indexOf('function setTheme('), dashboard.indexOf('\nconst voiceLabels'));
  assert.doesNotMatch(themeBlock, /\brefresh\s*\(|\bAPI\./);
});

test('生产构建包含本地地图、背景和 ECharts 且不含外部依赖地址', async () => {
  const paths = [
    'dist/assets/brand/jipin-screen-light-d0308f92.jpg',
    'dist/assets/brand/jipin-web-green-e90c36ef.jpg',
    'dist/assets/brand/jipin-screen-dark-e041ecf5.jpg',
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
