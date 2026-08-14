import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const projectRoot = new URL('../../', import.meta.url);

const BRAND_ASSETS = Object.freeze({
  'jipin-screen-light-d0308f92.jpg': 'D0308F92B54FCFCB783886704A7A1E85B1853B724784FB89BC0E9A79425211F8',
  'jipin-web-green-e90c36ef.jpg': 'E90C36EF7F198C1C1E4EE2FCDD517C09B71842D11CD1AF2764F27AED1EB131FE',
  'jipin-screen-dark-e041ecf5.jpg': 'E041ECF5C6ADD12F257F3CC07F862BE9B8DA9797477362C6C22EAA53709B069F',
});

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function ${name}`);
}

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

test('E02 保留语音入口和两个经营占比环图', async () => {
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
  assert.match(html, /本站不保存原始录音；转写文字最长约保留 10 分钟/);
  assert.match(html, /dashboard-v2\.js\?v=20260814-dashboard-presentation-4/);
  assert.match(html, /api\.js\?v=20260814-dashboard-presentation-4/);
  assert.doesNotMatch(html, /id="public-assistant-input"/);
});

test('同源录音 Worklet 与 WAV Worker 完整进入生产构建', async () => {
  for (const name of ['dashboard-audio-worklet.js', 'dashboard-wav-worker.js', 'dashboard-voice.js']) {
    const source = await readFile(new URL(`frontdesign-v1/${name}`, projectRoot));
    const output = await readFile(new URL(`dist/${name}`, projectRoot));
    assert.ok(source.byteLength > 100, name);
    assert.equal(createHash('sha256').update(output).digest('hex'), createHash('sha256').update(source).digest('hex'));
  }
  const voice = await readFile(new URL('frontdesign-v1/dashboard-voice.js', projectRoot), 'utf8');
  assert.match(voice, /new URL\('\.\/dashboard-audio-worklet\.js\?v=20260814-dashboard-presentation-4'/);
  assert.match(voice, /new URL\('\.\/dashboard-wav-worker\.js\?v=20260814-dashboard-presentation-4'/);
  assert.doesNotMatch(voice, /https?:\/\//);
});

test('三张吉品 Logo 在源码和构建产物中保持原始字节', async () => {
  for (const [name, expectedHash] of Object.entries(BRAND_ASSETS)) {
    for (const prefix of ['frontdesign-v1/assets/brand', 'dist/assets/brand']) {
      const bytes = await readFile(new URL(`${prefix}/${name}`, projectRoot));
      const actualHash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
      assert.equal(actualHash, expectedHash, `${prefix}/${name}`);
    }
  }
  await assert.rejects(access(new URL('frontdesign-v1/jipin-logo.jpg', projectRoot)));
  await assert.rejects(access(new URL('dist/jipin-logo.jpg', projectRoot)));
});

test('大屏主题恢复、非法值回退、Logo、ARIA 和客户端事件保持一致', async () => {
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  const functionSource = ['normalizePublicTheme', 'readStoredPublicTheme', 'storePublicTheme', 'applyPublicTheme']
    .map((name) => extractNamedFunction(scripts, name))
    .join('\n');
  const elements = {
    'dv2-brand-logo': {
      dataset: { daySrc: 'day-logo.jpg', nightSrc: 'night-logo.jpg' },
      source: 'night-logo.jpg',
      getAttribute(name) { return name === 'src' ? this.source : null; },
      setAttribute(name, value) { if (name === 'src') this.source = value; },
    },
    'public-theme-toggle': {
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    },
  };
  const appliedClasses = new Map();
  const events = [];
  const context = {
    localStorage: {
      value: 'invalid',
      getItem() { return this.value; },
      setItem(_key, value) { this.value = value; },
    },
    document: {
      body: { classList: { toggle(name, enabled) { appliedClasses.set(name, enabled); } } },
      getElementById(id) { return elements[id] || null; },
    },
    window: { dispatchEvent(event) { events.push(event); } },
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
  };
  const themeApi = runInNewContext(`${functionSource}; ({ normalizePublicTheme, readStoredPublicTheme, storePublicTheme, applyPublicTheme })`, context);

  assert.equal(themeApi.readStoredPublicTheme(), 'night');
  context.localStorage.getItem = () => { throw new Error('storage blocked'); };
  assert.equal(themeApi.readStoredPublicTheme(), 'night');
  context.localStorage.getItem = function getItem() { return this.value; };

  assert.equal(themeApi.applyPublicTheme('day'), 'day');
  assert.equal(appliedClasses.get('screen-day'), true);
  assert.equal(elements['dv2-brand-logo'].source, 'day-logo.jpg');
  assert.equal(elements['public-theme-toggle'].textContent, '夜间模式');
  assert.equal(elements['public-theme-toggle'].attributes['aria-pressed'], 'true');
  assert.equal(events.at(-1).type, 'app:public-theme-change');
  assert.equal(events.at(-1).detail.theme, 'day');

  assert.equal(themeApi.applyPublicTheme('unexpected'), 'night');
  assert.equal(appliedClasses.get('screen-day'), false);
  assert.equal(elements['dv2-brand-logo'].source, 'night-logo.jpg');
  assert.equal(elements['public-theme-toggle'].textContent, '日间模式');
  assert.equal(elements['public-theme-toggle'].attributes['aria-pressed'], 'false');
  assert.match(scripts, /applyPublicTheme\(readStoredPublicTheme\(\)\)/);
});

test('大屏主题切换只用当前快照重绘且保留图表实例', async () => {
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  const setTheme = extractNamedFunction(dashboard, 'setTheme');
  assert.match(dashboard, /window\.addEventListener\('app:public-theme-change'/);
  assert.match(
    dashboard,
    /bindEvents\(\);\s*setTheme\(document\.body\.classList\.contains\('screen-day'\) \? 'day' : 'night'\);/,
  );
  assert.match(setTheme, /state\.snapshot/);
  for (const renderer of ['renderDemandChart', 'renderMix', 'renderMap', 'renderStoredDialog']) {
    assert.match(setTheme, new RegExp(`\\b${renderer}\\s*\\(`));
  }
  assert.doesNotMatch(setTheme, /\b(?:API\.|fetch\s*\(|refresh\s*\(|dispose\s*\()/);
});

test('生产构建包含本地地图、背景和 ECharts 且不含外部依赖地址', async () => {
  const paths = [
    'dist/assets/brand/jipin-screen-light-d0308f92.jpg',
    'dist/assets/brand/jipin-web-green-e90c36ef.jpg',
    'dist/assets/brand/jipin-screen-dark-e041ecf5.jpg',
    'dist/assets/maps/northeast-china-admin1.geojson',
    'dist/assets/maps/changchun-service-area.geojson',
    'dist/assets/backgrounds/northeast-winter-corn-v1.webp',
    'dist/vendor/echarts/echarts.min.js',
  ];
  for (const path of paths) assert.ok((await stat(new URL(path, projectRoot))).size > 100);
  const textFiles = ['dist/index.html', 'dist/api.js', 'dist/scripts.js', 'dist/dashboard-v2.js', 'dist/dashboard.css'];
  const source = (await Promise.all(textFiles.map((path) => readFile(new URL(path, projectRoot), 'utf8')))).join('\n').toLowerCase();
  for (const banned of ['localhost', 'fonts.googleapis', 'cdnjs', 'unpkg.com', 'jsdelivr']) assert.equal(source.includes(banned), false, `found banned marker: ${banned}`);
  assert.match(source, /openstreetmap\.org\/copyright/);
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

test('构建脚本将演示 API 固定为同源且生产模式仍使用正式地址', async () => {
  const build = await readFile(new URL('build-cloudflare.mjs', projectRoot), 'utf8');
  assert.match(build, /includeDemoFixtures \? '\/api\/v1' : 'https:\/\/api\.flexibility607\.cn\/api\/v1'/);
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  assert.match(api, /if \(demoMode\) \{\s*return response\(false, 503, \{\s*code: 'DEMO_API_DISABLED'/);
  assert.match(api, /if \(demoMode\) return demoAssistantAnswer\(question, period\)/);
});
