import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AUDIO_BYTES,
  VOICE_STATES,
  VoiceQuestionController,
  extensionForMime,
  preferredRecorderMime,
  validateAudio,
} from '../dashboard-voice.js';

test('录音优先选择受支持的 WebM Opus', () => {
  class Recorder {}
  Recorder.isTypeSupported = (value) => value === 'audio/webm;codecs=opus';
  assert.equal(preferredRecorderMime(Recorder), 'audio/webm;codecs=opus');
  assert.equal(extensionForMime('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(extensionForMime('audio/mp4'), 'mp4');
});

test('音频大小和时长限制会在上传前拒绝', () => {
  assert.throws(() => validateAudio({ size: MAX_AUDIO_BYTES + 1 }, 3), /5 MiB/);
  assert.throws(() => validateAudio({ size: 100 }, 31), /30 秒/);
  assert.doesNotThrow(() => validateAudio({ size: 100 }, 30));
});

test('麦克风权限被拒绝时进入可重试的失败状态', async () => {
  const originalNavigator = globalThis.navigator;
  const originalRecorder = globalThis.MediaRecorder;
  const transitions = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => {
      const error = new Error('denied');
      error.name = 'NotAllowedError';
      throw error;
    } } },
  });
  globalThis.MediaRecorder = class MediaRecorder {};
  try {
    const controller = new VoiceQuestionController({
      api: {},
      onState: (state, detail) => transitions.push({ state, detail }),
    });
    await controller.start('30d');
    assert.equal(controller.state, VOICE_STATES.ERROR);
    assert.match(transitions.at(-1).detail, /权限被拒绝/);
  } finally {
    if (originalNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
    if (originalRecorder === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = originalRecorder;
  }
});
