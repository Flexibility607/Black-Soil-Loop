import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const mockDir = join(projectRoot, 'frontend-mocks-v0.1');
const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:8787/');

if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  throw new Error('The verification URL must use http or https.');
}

const mockFiles = (await readdir(mockDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort();

async function request(path) {
  const url = new URL(path, baseUrl);
  return fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
}

async function requireOk(path) {
  const response = await request(path);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
  return response;
}

const html = await (await requireOk('/')).text();
for (const marker of ['id="toggle-mock"', 'checked', 'id="public-screen-canvas"']) {
  if (!html.includes(marker)) throw new Error(`The deployed page is missing ${marker}.`);
}

for (const path of ['/styles.css', '/api.js', '/scripts.js']) {
  const content = await (await requireOk(path)).text();
  if (content.length < 100) throw new Error(`${path} is unexpectedly empty.`);
}

for (const name of mockFiles) {
  const response = await requireOk(`/frontend-mocks-v0.1/${name}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data')) {
    throw new Error(`${name} is not a valid Mock response envelope.`);
  }
}

const missing = await request('/frontend-mocks-v0.1/__missing__.json');
if (missing.status !== 404) {
  throw new Error(`A missing Mock file should return 404, received ${missing.status}.`);
}

console.log(`Cloud Mock verification passed: ${baseUrl.origin}, ${mockFiles.length} JSON files.`);
