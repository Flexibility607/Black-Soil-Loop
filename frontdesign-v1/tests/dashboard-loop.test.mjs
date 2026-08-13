import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSeamlessLoop } from '../dashboard-loop.js';

class FakeElement {
  constructor({ height = 0, children = [] } = {}) {
    this.scrollHeight = height;
    this.clientHeight = height;
    this.children = children;
    this.dataset = {};
    this.hidden = false;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = { setProperty() {} };
  }

  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  querySelectorAll() { return []; }
  append(child) { this.children.push(child); }
  contains() { return false; }
  cloneNode() { return new FakeElement({ height: this.scrollHeight }); }
  animate(frames, options) {
    this.animation = {
      frames, options, playCount: 0, pauseCount: 0, cancelCount: 0,
      play() { this.playCount += 1; },
      pause() { this.pauseCount += 1; },
      cancel() { this.cancelCount += 1; },
    };
    return this.animation;
  }
}

function installGlobals({ reduced = false } = {}) {
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.getComputedStyle = () => ({ rowGap: '4px' });
  globalThis.document = { activeElement: null };
}

test('连续循环复制一份轨道并以第一份完整高度无缝位移', () => {
  installGlobals();
  const track = new FakeElement({ height: 132, children: [new FakeElement(), new FakeElement()] });
  const viewport = new FakeElement({ height: 100 });
  const button = new FakeElement();
  const controller = createSeamlessLoop({ viewport, track, pauseButton: button, signature: 'v1', speedPxPerSecond: 8, itemCount: 2 });
  assert.equal(track.children.length, 4);
  assert.equal(track.children[2].attributes.get('aria-hidden'), 'true');
  assert.deepEqual(track.animation.frames, [
    { transform: 'translate3d(0,0,0)' },
    { transform: 'translate3d(0,-136px,0)' },
  ]);
  assert.equal(track.animation.options.duration, 17000);
  assert.equal(button.hidden, false);
  button.listeners.get('click')();
  assert.equal(button.dataset.manualPaused, 'true');
  assert.ok(track.animation.pauseCount > 0);
  controller.destroy();
  assert.equal(track.animation.cancelCount, 1);
});

test('连续循环控制器不包含网络或业务刷新调用', async () => {
  const source = await readFile(new URL('../dashboard-loop.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|API\.|refreshInformation|refresh\(\{\s*force/);
});

test('减少动态偏好下不复制内容，用户可显式启动', () => {
  installGlobals({ reduced: true });
  const track = new FakeElement({ height: 132, children: [new FakeElement(), new FakeElement()] });
  const viewport = new FakeElement({ height: 100 });
  const button = new FakeElement();
  createSeamlessLoop({ viewport, track, pauseButton: button, signature: 'reduced', itemCount: 2 });
  assert.equal(track.children.length, 2);
  assert.equal(track.animation, undefined);
  assert.equal(button.dataset.manualPaused, 'true');
  button.listeners.get('click')();
  assert.equal(track.children.length, 4);
  assert.ok(track.animation);
});

test('内容不溢出时不创建动画且不会复制读屏内容', () => {
  installGlobals();
  const track = new FakeElement({ height: 68, children: [new FakeElement()] });
  const viewport = new FakeElement({ height: 102 });
  const button = new FakeElement();
  createSeamlessLoop({ viewport, track, pauseButton: button, signature: 'short', itemCount: 1 });
  assert.equal(track.children.length, 1);
  assert.equal(track.animation, undefined);
  assert.equal(button.hidden, true);
});
