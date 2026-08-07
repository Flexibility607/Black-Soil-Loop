import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../cloudflare-worker.js';

test('Worker 保留 /api/v1 路径并覆盖浏览器伪造的服务令牌', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (request) => {
    forwarded = request;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const request = new Request('https://dashboard.example/api/v1/public/dashboard/snapshot?period=7d', {
      headers: { 'x-dashboard-service-token': 'spoofed' },
    });
    const response = await worker.fetch(request, {
      BACKEND_API_BASE_URL: 'https://backend.example',
      DASHBOARD_SERVICE_TOKEN: 'server-secret',
      ASSETS: { fetch: async () => new Response('asset') },
    });
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, 'https://backend.example/api/v1/public/dashboard/snapshot?period=7d');
    assert.equal(forwarded.headers.get('x-dashboard-service-token'), 'server-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker 未配置后端时返回受控 503，静态路径仍交给 ASSETS', async () => {
  const apiResponse = await worker.fetch(new Request('https://dashboard.example/api/v1/health'), { ASSETS: { fetch: async () => new Response('asset') } });
  assert.equal(apiResponse.status, 503);
  const assetResponse = await worker.fetch(new Request('https://dashboard.example/assets/maps/map.json'), { ASSETS: { fetch: async () => new Response('asset-ok') } });
  assert.equal(await assetResponse.text(), 'asset-ok');
});
