import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./pages-forwarder/public/_worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const worker = (await import(moduleUrl)).default;

let forwardedRequest;
const env = {
  UPSTREAM: {
    async fetch(request) {
      forwardedRequest = request;
      return new Response('forwarded', {
        status: 308,
        headers: { location: 'https://black-soil-loop.internal/frontdesign-v1/?mode=mock' },
      });
    },
  },
};

const response = await worker.fetch(
  new Request('https://black-soil-loop-f607.pages.dev/frontdesign-v1?mode=mock'),
  env,
);
assert.equal(new URL(forwardedRequest.url).pathname, '/frontdesign-v1');
assert.equal(new URL(forwardedRequest.url).search, '?mode=mock');
assert.equal(response.status, 308);
assert.equal(
  response.headers.get('location'),
  'https://black-soil-loop-f607.pages.dev/frontdesign-v1/?mode=mock',
);
assert.equal(response.headers.get('x-black-soil-loop-proxy'), 'pages-service-binding');
assert.equal(await response.text(), 'forwarded');

const unavailable = await worker.fetch(new Request('https://black-soil-loop-f607.pages.dev/'), {});
assert.equal(unavailable.status, 503);

console.log('Pages forwarder verification passed.');
