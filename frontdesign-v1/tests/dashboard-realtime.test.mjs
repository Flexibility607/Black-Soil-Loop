import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  eventTargets,
  POLLING_INTERVAL_MS,
  RECONNECT_DELAYS_MS,
  RealtimeCoordinator,
} from '../dashboard-realtime.js';

const projectRoot = new URL('../../', import.meta.url);

test('实时事件映射到 E01 和 E02 相关缓存', () => {
  assert.deepEqual(eventTargets('store.receipt.completed'), ['overview', 'inventory']);
  assert.deepEqual(eventTargets('transport.plan.confirmed'), ['overview', 'production', 'transport']);
  assert.deepEqual(eventTargets('transport.task.status_changed'), ['overview', 'transport']);
  assert.ok(eventTargets('unknown.topic').includes('enterprise'));
});

test('SSE 断线使用指数退避并启动 30 秒轮询', async () => {
  const timeouts = [];
  const intervals = [];
  const states = [];
  const coordinator = new RealtimeCoordinator({
    subscribe: (_onEvent, _signal, onOpen) => {
      onOpen();
      return Promise.reject(new Error('connection lost'));
    },
    onEvent: () => {},
    onPoll: () => {},
    onState: (state) => states.push(state),
    setTimeoutFn: (callback, delay) => {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    clearTimeoutFn: () => {},
    setIntervalFn: (callback, delay) => {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    clearIntervalFn: () => {},
  });
  coordinator.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timeouts[0].delay, RECONNECT_DELAYS_MS[0]);
  assert.equal(intervals[0].delay, POLLING_INTERVAL_MS);
  assert.deepEqual(states, ['connected', 'polling']);
  coordinator.stop();
});

test('SSE 客户端恢复 cursor 并去重事件', async () => {
  const api = await readFile(new URL('frontdesign-v1/api.js', projectRoot), 'utf8');
  assert.match(api, /Last-Event-ID/);
  assert.match(api, /nextCursor <= cursor/);
  assert.match(api, /recentDashboardEventIds\.has/);
  assert.match(api, /sessionStorage\.setItem\('blacksoil\.dashboard\.cursor'/);
});

test('E01 与 E02 共用 800 毫秒事件合并刷新', async () => {
  const dashboard = await readFile(new URL('frontdesign-v1/dashboard-v2.js', projectRoot), 'utf8');
  assert.match(dashboard, /setTimeout\(flushRealtimeRefresh, 800\)/);
  assert.match(dashboard, /blacksoil:e01-realtime-refresh/);
  assert.match(dashboard, /refresh\(\{ force: true \}\)/);
});
