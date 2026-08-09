import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../../', import.meta.url);

test('E01 使用下周批量预测接口并保留批次读取接口', async () => {
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  assert.match(api, /\/web\/forecasts\/next-week\/generate/);
  assert.match(api, /\/web\/forecasts\/next-week/);
  assert.match(scripts, /generateNextWeekForecast/);
  assert.match(scripts, /data\.period\?\.start/);
});

test('下周预测汇总展示历史、计划、预测、区间和误差指标', async () => {
  const html = await readFile(new URL('frontdesign-v1/index.html', projectRoot), 'utf8');
  const scripts = await readFile(new URL('frontdesign-v1/scripts.js', projectRoot), 'utf8');
  const styles = await readFile(new URL('frontdesign-v1/styles.css', projectRoot), 'utf8');
  assert.match(html, /id="forecast-aggregation-board"/);
  for (const label of ['历史用量', '生产计划', '预测结果', '建议采购', 'MAE', 'sMAPE', '数据截止', '数据不足']) {
    assert.match(scripts, new RegExp(label));
  }
  assert.match(scripts, /季节性平滑 \/ 加权移动平均 \/ 生产计划降级/);
  assert.match(styles, /\.forecast-compare-bars/);
  assert.match(styles, /--forecast-value/);
});
