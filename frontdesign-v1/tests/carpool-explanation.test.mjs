import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../../', import.meta.url);

test('拼车结果中文展示两两校验、利用率、绕行和里程收益', async () => {
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  for (const label of [
    '候选组两两距离校验',
    '车辆容量使用率',
    '合并路线估算里程',
    '独立运输估算里程',
    '估算绕行距离',
    '估算合单里程收益',
  ]) assert.match(scripts, new RegExp(label));
});
