function jsonError(status, code, message) {
  return new Response(JSON.stringify({ status: 'FAILED', code, data: null, errors: [{ message }] }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function backendUrl(requestUrl, baseValue, allowInsecure) {
  const base = new URL(baseValue);
  if (base.protocol !== 'https:' && allowInsecure !== 'true') {
    throw new Error('BACKEND_API_BASE_URL must use HTTPS unless ALLOW_INSECURE_BACKEND=true.');
  }
  const incoming = new URL(requestUrl);
  return new URL(`${incoming.pathname}${incoming.search}`, `${base.origin}/`);
}

async function proxyApi(request, env) {
  if (!env.BACKEND_API_BASE_URL) return jsonError(503, 'BACKEND_NOT_CONFIGURED', '后端源站尚未配置。');
  let target;
  try {
    target = backendUrl(request.url, env.BACKEND_API_BASE_URL, env.ALLOW_INSECURE_BACKEND);
  } catch (error) {
    return jsonError(503, 'BACKEND_CONFIGURATION_ERROR', error.message);
  }
  const headers = new Headers(request.headers);
  headers.delete('x-dashboard-service-token');
  if (env.DASHBOARD_SERVICE_TOKEN) headers.set('x-dashboard-service-token', env.DASHBOARD_SERVICE_TOKEN);
  headers.set('x-forwarded-host', new URL(request.url).host);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  try {
    const response = await fetch(new Request(target, init));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-black-soil-loop-proxy', 'cloudflare-worker');
    responseHeaders.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch {
    return jsonError(502, 'BACKEND_UNAVAILABLE', '后端服务暂时不可用。');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/v1/')) return proxyApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
