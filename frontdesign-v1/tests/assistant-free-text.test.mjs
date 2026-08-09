import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../', import.meta.url);

test('E02 保留预设和语音并提供自由文字提问', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('index.html', base), 'utf8'),
    readFile(new URL('dashboard-v2.js', base), 'utf8'),
  ]);
  assert.match(html, /id="dv2-assistant-form"/);
  assert.match(html, /id="dv2-assistant-input"/);
  assert.match(html, /id="dv2-mic-button"/);
  assert.match(html, /data-example=/);
  assert.match(script, /submitAssistantQuestion/);
  assert.match(script, /\['bar', 'line', 'donut', 'route'\]/);
  assert.doesNotMatch(script, /eval\s*\(/);
  assert.doesNotMatch(script, /new Function\s*\(/);
});
