import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('7 日、30 日和本月分别产生服务器查询参数', async () => {
  const source = await readFile(new URL('../api.js', import.meta.url), 'utf8');
  const requests = [];
  const storage = new Map();
  const context = {
    AbortController,
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    FormData,
    Headers,
    TextDecoder,
    URLSearchParams,
    fetch: async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ period: new URL(url).searchParams.get('period'), items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout,
    clearTimeout,
    window: {
      BLACKSOIL_CONFIG: { apiBase: 'https://example.test/api/v1', demo: false },
      location: { hostname: 'example.test' },
      addEventListener: () => {},
      dispatchEvent: () => {},
      setTimeout,
      clearTimeout,
    },
  };
  vm.runInNewContext(source, context);

  for (const period of ['7d', '30d', 'month']) {
    const response = await context.window.API.getDashboardSnapshot(period, false);
    assert.equal(response.ok, true);
  }
  assert.deepEqual(
    requests.map((url) => new URL(url).searchParams.get('period')),
    ['7d', '30d', 'month'],
  );
  assert.ok(requests.every((url) => new URL(url).pathname === '/api/v1/public/dashboard/snapshot'));
});
