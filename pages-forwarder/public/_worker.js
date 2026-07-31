const SERVICE_ORIGIN = 'https://black-soil-loop.internal';

function upstreamRequest(request) {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, SERVICE_ORIGIN);
  const init = {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  return new Request(targetUrl, init);
}

function proxyResponse(response, incomingUrl) {
  const headers = new Headers(response.headers);
  const location = headers.get('location');
  if (location) {
    const upstreamLocation = new URL(location, SERVICE_ORIGIN);
    if (upstreamLocation.origin === SERVICE_ORIGIN) {
      headers.set('location', new URL(upstreamLocation.pathname + upstreamLocation.search + upstreamLocation.hash, incomingUrl.origin));
    }
  }
  headers.set('x-black-soil-loop-proxy', 'pages-service-binding');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    if (!env.UPSTREAM) return new Response('Pages proxy binding is unavailable.', { status: 503 });
    try {
      const response = await env.UPSTREAM.fetch(upstreamRequest(request));
      return proxyResponse(response, new URL(request.url));
    } catch {
      return new Response('The upstream demonstration site is temporarily unavailable.', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
