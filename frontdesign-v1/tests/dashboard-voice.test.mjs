import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  MAX_AUDIO_BYTES,
  VOICE_STATES,
  VoiceQuestionController,
  createPcmCaptureSession,
  createRequestId,
  prepareAudioContext,
  validateAudio,
} from '../dashboard-voice.js';
import {
  encodePcm16Wav,
  resampleMono,
} from '../dashboard-wav-worker.js';

function wavHeader(buffer) {
  const view = new DataView(buffer);
  const text = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  return {
    riff: text(0, 4),
    wave: text(8, 4),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}

test('48 kHz 和 44.1 kHz 均降采样为真实 16 kHz 单声道 16 位 WAV', () => {
  for (const sourceRate of [48_000, 44_100]) {
    const input = new Float32Array(sourceRate).fill(0.25);
    const encoded = encodePcm16Wav([input], sourceRate);
    const header = wavHeader(encoded.buffer);
    assert.deepEqual(header, {
      riff: 'RIFF',
      wave: 'WAVE',
      format: 1,
      channels: 1,
      sampleRate: 16_000,
      byteRate: 32_000,
      blockAlign: 2,
      bitsPerSample: 16,
      dataBytes: 32_000,
    });
    assert.equal(encoded.buffer.byteLength, 32_044);
    assert.equal(encoded.durationSeconds, 1);
    const sample = new DataView(encoded.buffer).getInt16(44, true);
    assert.ok(sample >= 8190 && sample <= 8192, `${sourceRate}: ${sample}`);
  }
});

test('区间平均降采样保持恒定信号并按比例处理脉冲与长度', () => {
  const constant = resampleMono(new Float32Array(48_000).fill(-0.5), 48_000);
  assert.equal(constant.length, 16_000);
  assert.ok(constant.every((sample) => Math.abs(sample + 0.5) < 1e-6));

  const impulse = new Float32Array(48_000);
  impulse[0] = 1;
  const reduced = resampleMono(impulse, 48_000);
  assert.equal(reduced.length, 16_000);
  assert.ok(Math.abs(reduced[0] - (1 / 3)) < 1e-6);
  assert.ok(reduced.slice(1).every((sample) => sample === 0));
  assert.equal(resampleMono(new Float32Array(44_100), 44_100).length, 16_000);
});

test('音频大小、空内容和时长限制在上传前拒绝', () => {
  assert.throws(() => validateAudio({ size: MAX_AUDIO_BYTES + 1 }, 3), /2 MiB/);
  assert.throws(() => validateAudio({ size: 0 }, 3), /为空/);
  assert.throws(() => validateAudio({ size: 100 }, 0), /时长无效/);
  assert.throws(() => validateAudio({ size: 100 }, 30.001), /30 秒/);
  assert.throws(() => validateAudio({ size: 100 }, 31), /30 秒/);
  assert.doesNotThrow(() => validateAudio({ size: 960_044 }, 30));
});

test('采集调度略超时时 WAV 会严格截断为 30 秒', () => {
  const encoded = encodePcm16Wav([new Float32Array(48_000 * 31).fill(0.1)], 48_000);
  assert.equal(encoded.durationSeconds, 30);
  assert.equal(encoded.buffer.byteLength, 960_044);
  assert.equal(wavHeader(encoded.buffer).dataBytes, 960_000);
});

test('语音轮次编号始终是合法 UUID v4', () => {
  const id = createRequestId({ getRandomValues(bytes) { bytes.fill(7); return bytes; } });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('AudioWorklet 是主采集路径并在结束时关闭 AudioContext', async () => {
  let contextInstance;
  let loadedModule = '';
  class FakeContext {
    constructor() {
      contextInstance = this;
      this.sampleRate = 48_000;
      this.state = 'running';
      this.destination = {};
      this.audioWorklet = { addModule: async (url) => { loadedModule = String(url); } };
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() { throw new Error('fallback must not be used'); }
    async close() { this.state = 'closed'; }
  }
  class FakeWorkletNode {
    constructor() {
      this.port = {
        onmessage: null,
        start() {},
        postMessage: ({ type }) => {
          if (type !== 'stop') return;
          const samples = new Float32Array([0.1, 0.2]);
          this.port.onmessage({ data: { type: 'samples', samples: samples.buffer } });
          this.port.onmessage({ data: { type: 'stopped' } });
        },
      };
    }
    connect() {}
    disconnect() {}
  }
  const session = await createPcmCaptureSession({}, {
    AudioContextClass: FakeContext,
    AudioWorkletNodeClass: FakeWorkletNode,
    workletModuleUrl: './same-origin-worklet.js',
  });
  assert.equal(session.mode, 'audio-worklet');
  assert.equal(loadedModule, './same-origin-worklet.js');
  const captured = await session.stop();
  assert.equal(captured.chunks.length, 1);
  assert.equal(captured.chunks[0].length, 2);
  assert.equal(contextInstance.state, 'closed');
});

test('AudioContext 在请求麦克风权限前创建并恢复，Safari 挂起时明确降级', async () => {
  let closed = 0;
  class ResumableContext {
    constructor() { this.state = 'suspended'; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; closed += 1; }
  }
  const prepared = await prepareAudioContext({ AudioContextClass: ResumableContext });
  assert.equal(prepared.state, 'running');
  await prepared.close();

  class BlockedContext {
    constructor() { this.state = 'suspended'; }
    async resume() {}
    async close() { this.state = 'closed'; closed += 1; }
  }
  await assert.rejects(
    prepareAudioContext({ AudioContextClass: BlockedContext }),
    /暂未允许音频采集/,
  );
  assert.equal(closed, 2);

  const events = [];
  const preparedContext = { state: 'running', async close() {} };
  const controller = new VoiceQuestionController({
    api: {},
    prepareContext: async () => { events.push('audio-context'); return preparedContext; },
    mediaDevices: { getUserMedia: async () => {
      events.push('microphone-permission');
      return { getTracks: () => [{ stop() {} }] };
    } },
    captureFactory: async (_stream, options) => {
      events.push('capture');
      assert.equal(options.context, preparedContext);
      return { stop: async () => ({ chunks: [], sampleRate: 48_000 }), release: async () => {} };
    },
  });
  await controller.start('30d');
  assert.deepEqual(events, ['audio-context', 'microphone-permission', 'capture']);
  controller.cancel();
});

test('AudioWorklet 缺失时使用 ScriptProcessor 并在结束时关闭 AudioContext', async () => {
  let contextInstance;
  class FakeContext {
    constructor() {
      contextInstance = this;
      this.sampleRate = 44_100;
      this.state = 'running';
      this.destination = {};
      this.processor = null;
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() {
      this.processor = { onaudioprocess: null, connect() {}, disconnect() {} };
      return this.processor;
    }
    async close() { this.state = 'closed'; }
  }
  const session = await createPcmCaptureSession({}, { AudioContextClass: FakeContext });
  assert.equal(session.mode, 'script-processor');
  contextInstance.processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array([0.3, -0.3, 0.1]) },
  });
  const captured = await session.stop();
  assert.equal(captured.sampleRate, 44_100);
  assert.deepEqual([...captured.chunks[0]], [0.30000001192092896, -0.30000001192092896, 0.10000000149011612]);
  assert.equal(contextInstance.state, 'closed');
});

test('转写成功后回填文字并按当前周期自动查询，最后释放音轨', async () => {
  let stoppedTracks = 0;
  let closedCapture = 0;
  const calls = [];
  const transcripts = [];
  const answers = [];
  const controller = new VoiceQuestionController({
    api: {
      async transcribeDashboardAudio(blob, duration, filename, options) {
        calls.push({ type: 'transcribe', blob, duration, filename, options });
        return { ok: true, json: { data: { text: '本月第三空间营业额是多少？' } } };
      },
      async queryDashboardAssistant(question, period, parkId, preferredChart, options) {
        calls.push({ type: 'query', question, period, parkId, preferredChart, options });
        return { ok: true, json: { data: { answer: '营业额为 100 元。' } } };
      },
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] }) },
    captureFactory: async () => ({
      stop: async () => ({ chunks: [new Float32Array(1600).fill(0.1)], sampleRate: 16_000 }),
      release: async () => { closedCapture += 1; },
    }),
    onTranscript: (value) => transcripts.push(value),
    onAnswer: (value) => answers.push(value),
  });
  await controller.start('month');
  await controller.stop('month');
  assert.equal(controller.state, VOICE_STATES.DONE);
  assert.deepEqual(transcripts, ['本月第三空间营业额是多少？']);
  assert.deepEqual(answers, [{ answer: '营业额为 100 元。' }]);
  assert.equal(calls[0].filename, 'question.wav');
  assert.equal(calls[0].blob.type, 'audio/wav');
  assert.match(calls[0].options.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(calls[1].period, 'month');
  assert.equal(calls[1].options.requestId, calls[0].options.requestId);
  assert.equal(calls[0].options.signal, calls[1].options.signal);
  assert.equal(stoppedTracks, 1);
  assert.equal(closedCapture, 0, 'capture.stop owns AudioContext cleanup');
});

test('录音倒计时从 30 秒开始并在 30 秒自动停止', async () => {
  let timeoutCallback;
  let timeoutDelay;
  const states = [];
  const controller = new VoiceQuestionController({
    api: {
      async transcribeDashboardAudio() { return { ok: true, json: { data: { text: '园区概览' } } }; },
      async queryDashboardAssistant() { return { ok: true, json: { data: { answer: '完成' } } }; },
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    captureFactory: async () => ({
      stop: async () => ({ chunks: [new Float32Array(4800).fill(0.1)], sampleRate: 16_000 }),
      release: async () => {},
    }),
    timers: {
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout(callback, delay) { timeoutCallback = callback; timeoutDelay = delay; return 2; },
      clearTimeout: () => {},
    },
    onState: (state, detail) => states.push({ state, detail }),
  });
  await controller.start('30d');
  assert.equal(timeoutDelay, 30_000);
  assert.match(states.at(-1).detail, /剩余 30 秒/);
  await timeoutCallback();
  assert.equal(controller.state, VOICE_STATES.DONE);
});

test('录音从 30d 切换到 month 后取消旧轮次，旧自动停止不会发起查询', async () => {
  let timeoutCallback;
  let transcriptions = 0;
  const controller = new VoiceQuestionController({
    api: {
      async transcribeDashboardAudio() { transcriptions += 1; return { ok: true, json: { data: { text: '旧问题' } } }; },
      async queryDashboardAssistant() { return { ok: true, json: { data: { answer: '旧回答' } } }; },
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    captureFactory: async () => ({
      stop: async () => ({ chunks: [new Float32Array(4800).fill(0.1)], sampleRate: 16_000 }),
      release: async () => {},
    }),
    timers: {
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout(callback) { timeoutCallback = callback; return 2; },
      clearTimeout: () => {},
    },
  });
  await controller.start('30d');
  assert.equal(controller.cancel('统计周期已切换，请按新周期重新录音'), true);
  await timeoutCallback();
  assert.equal(controller.state, VOICE_STATES.CANCELLED);
  assert.equal(transcriptions, 0);

  const dashboard = await readFile(new URL('../dashboard-v2.js', import.meta.url), 'utf8');
  assert.match(
    dashboard,
    /button\.dataset\.period !== state\.period && voice\.busy[\s\S]*voice\.cancel\('统计周期已切换，请按新周期重新录音'\)[\s\S]*state\.period = button\.dataset\.period/,
  );
});

test('取消会中止上传、隔离旧响应并释放采集资源和音轨', async () => {
  let resolveTranscription;
  let requestSignal;
  let stoppedTracks = 0;
  let answerCount = 0;
  const pendingTranscription = new Promise((resolve) => { resolveTranscription = resolve; });
  const controller = new VoiceQuestionController({
    api: {
      transcribeDashboardAudio(_blob, _duration, _filename, options) {
        requestSignal = options.signal;
        return pendingTranscription;
      },
      async queryDashboardAssistant() {
        return { ok: true, json: { data: { answer: '旧回答' } } };
      },
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] }) },
    captureFactory: async () => ({
      stop: async () => ({ chunks: [new Float32Array(1600).fill(0.1)], sampleRate: 16_000 }),
      release: async () => {},
    }),
    onAnswer: () => { answerCount += 1; },
  });
  await controller.start('7d');
  const stopping = controller.stop('7d');
  while (!requestSignal) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.cancel(), true);
  assert.equal(requestSignal.aborted, true);
  resolveTranscription({ ok: true, json: { data: { text: '旧问题' } } });
  await stopping;
  assert.equal(controller.state, VOICE_STATES.CANCELLED);
  assert.equal(answerCount, 0);
  assert.equal(stoppedTracks, 1);
});

test('麦克风权限被拒绝时进入文字降级状态', async () => {
  const transitions = [];
  let fallback = '';
  const controller = new VoiceQuestionController({
    api: {},
    prepareContext: async () => null,
    mediaDevices: { getUserMedia: async () => {
      const error = new Error('denied');
      error.name = 'NotAllowedError';
      throw error;
    } },
    onState: (state, detail) => transitions.push({ state, detail }),
    onFallback: (detail) => { fallback = detail; },
  });
  await controller.start('30d');
  assert.equal(controller.state, VOICE_STATES.ERROR);
  assert.match(transitions.at(-1).detail, /权限被拒绝/);
  assert.match(fallback, /权限被拒绝/);
});

test('服务端未知错误不会把上游原始响应显示到大屏', () => {
  const controller = new VoiceQuestionController({ api: {} });
  const message = controller.apiError({
    status: 502,
    json: { message: 'ALIYUN_SECRET_UPSTREAM_PAYLOAD', detail: { message: 'provider stack' } },
  });
  assert.equal(message, '语音服务暂时不可用，请使用文字提问。');
  assert.doesNotMatch(message, /ALIYUN|provider stack/);
});

test('常见语音 HTTP 错误均映射为受控中文提示', () => {
  const controller = new VoiceQuestionController({ api: {} });
  const cases = [
    [{ status: 401, json: {} }, /登录会话已过期/],
    [{ status: 413, json: { code: 'AUDIO_TOO_LARGE' } }, /2 MiB/],
    [{ status: 415, json: { code: 'AUDIO_TYPE_NOT_ALLOWED' } }, /格式不受支持/],
    [{ status: 422, json: { code: 'AUDIO_INVALID' } }, /录音内容无效/],
    [{ status: 429, json: { code: 'VOICE_RATE_LIMITED' } }, /使用较频繁/],
    [{ status: 429, json: { code: 'VOICE_CONCURRENCY_EXCEEDED' } }, /语音请求较多/],
    [{ status: 429, json: { code: 'VOICE_DAILY_BUDGET_EXHAUSTED' } }, /今日语音额度/],
    [{ status: 502, json: { code: 'TRANSCRIPTION_FAILED' } }, /识别暂时不可用/],
    [{ status: 502, json: { code: 'TRANSCRIPTION_EMPTY' } }, /没有识别到有效问题/],
    [{ status: 503, json: { code: 'TRANSCRIPTION_NOT_CONFIGURED' } }, /尚未配置/],
    [{ status: 503, json: { code: 'VOICE_DISABLED' } }, /暂未开放/],
  ];
  for (const [result, expected] of cases) assert.match(controller.apiError(result), expected);
});

test('转写断网时显示确定性中文降级且不泄露浏览器原始异常', async () => {
  let fallback = '';
  const controller = new VoiceQuestionController({
    api: {
      async transcribeDashboardAudio() { throw new TypeError('Failed to fetch'); },
      async queryDashboardAssistant() { throw new Error('must not query'); },
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    captureFactory: async () => ({
      stop: async () => ({ chunks: [new Float32Array(1600).fill(0.1)], sampleRate: 16_000 }),
      release: async () => {},
    }),
    onFallback: (detail) => { fallback = detail; },
  });
  await controller.start('30d');
  await controller.stop('30d');
  assert.equal(controller.state, VOICE_STATES.ERROR);
  assert.match(fallback, /网络连接失败/);
  assert.doesNotMatch(fallback, /Failed to fetch/);
});

test('API 按登录状态选择转写路由并透传 UUID、取消信号和统计周期', async () => {
  const source = await readFile(new URL('../api.js', import.meta.url), 'utf8');
  const requests = [];
  const requestId = '12345678-1234-4123-8123-123456789abc';
  const context = {
    AbortController,
    Blob,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    FormData,
    Headers,
    TextDecoder,
    URLSearchParams,
    crypto: { randomUUID: () => requestId },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      const path = new URL(url).pathname;
      const payload = path.endsWith('/auth/login')
        ? { access_token: 'token', csrf_token: 'csrf', user: { id: 'u1' } }
        : path.endsWith('/transcriptions') ? { transcript: '测试问题' } : { answer: '测试回答' };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    setTimeout,
    clearTimeout,
    window: {
      BLACKSOIL_CONFIG: { apiBase: 'https://example.test/api/v1', demo: false },
      location: { hostname: 'example.test' },
      addEventListener: () => {},
      dispatchEvent: () => {},
      setTimeout,
      clearTimeout,
    },
  };
  vm.runInNewContext(source, context);
  const signal = new AbortController().signal;
  const blob = new Blob([new Uint8Array(64)], { type: 'audio/wav' });
  await context.window.API.transcribeDashboardAudio(blob, 0.001, 'question.wav', { requestId, signal });
  await context.window.API.queryDashboardAssistant('最近需求趋势', '7d', null, null, { requestId, signal });
  await context.window.API.login('user', 'password');
  await context.window.API.transcribeDashboardAudio(blob, 0.001, 'question.wav', { requestId, signal });

  const [anonymousVoice, anonymousQuery, , authenticatedVoice] = requests;
  assert.equal(new URL(anonymousVoice.url).pathname, '/api/v1/public/assistant/transcriptions');
  assert.equal(anonymousVoice.options.headers.get('Idempotency-Key'), requestId);
  assert.equal(anonymousVoice.options.headers.get('X-Trace-Id'), requestId);
  assert.equal(anonymousVoice.options.body.get('client_request_id'), requestId);
  assert.equal(anonymousVoice.options.signal, signal);
  assert.equal(anonymousQuery.options.headers.get('X-Trace-Id'), requestId);
  assert.equal(anonymousQuery.options.signal, signal);
  assert.equal(JSON.parse(anonymousQuery.options.body).period, '7d');
  assert.equal(new URL(authenticatedVoice.url).pathname, '/api/v1/web/assistant/transcriptions');
  assert.equal(authenticatedVoice.options.headers.get('Authorization'), 'Bearer token');
  context.window.API.clearTokens();
});

test('演示模式不请求生产 API，语音受控降级且文字助手只读取本地快照', async () => {
  const [source, fixture] = await Promise.all([
    readFile(new URL('../api.js', import.meta.url), 'utf8'),
    readFile(new URL('../../frontend-mocks-v0.1/e02-dashboard-snapshot.json', import.meta.url), 'utf8'),
  ]);
  const requests = [];
  const context = {
    AbortController,
    Blob,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    FormData,
    Headers,
    TextDecoder,
    URLSearchParams,
    fetch: async (url) => {
      requests.push(String(url));
      return new Response(fixture, { status: 200, headers: { 'content-type': 'application/json' } });
    },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    setTimeout,
    clearTimeout,
    window: {
      BLACKSOIL_CONFIG: { apiBase: '/api/v1', demo: true },
      location: { hostname: 'loop.flexibility607.cn' },
      addEventListener: () => {},
      dispatchEvent: () => {},
      setTimeout,
      clearTimeout,
    },
  };
  vm.runInNewContext(source, context);
  const voice = await context.window.API.transcribeDashboardAudio(
    new Blob([new Uint8Array(64)], { type: 'audio/wav' }),
    0.001,
  );
  const questions = await Promise.all([
    context.window.API.queryDashboardAssistant('第三空间营业额占比是多少？', '30d'),
    context.window.API.queryDashboardAssistant('最近的需求趋势如何？', '7d'),
    context.window.API.queryDashboardAssistant('第三空间销售排行', 'month'),
  ]);
  await context.window.API.getDictionaries();
  await context.window.API.request('/web/master-data/products');

  assert.equal(voice.ok, false);
  assert.equal(voice.status, 503);
  assert.equal(voice.json.code, 'VOICE_DISABLED');
  assert.ok(questions.every((item) => item.ok && item.json.data.mode === 'demo_deterministic'));
  assert.deepEqual(questions.map((item) => item.json.data.period), ['30d', '7d', 'month']);
  assert.deepEqual(questions.map((item) => item.json.data.chart.kind), ['donut', 'line', 'bar']);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((url) => url === './frontend-mocks-v0.1/e02-dashboard-snapshot.json'));
  assert.equal(requests.filter((url) => /api\.flexibility607\.cn|\/api\/v1/.test(url)).length, 0);
});

test('页面隐藏和离开 E02 都会停止活动语音且没有 TTS', async () => {
  const dashboard = await readFile(new URL('../dashboard-v2.js', import.meta.url), 'utf8');
  assert.match(dashboard, /if \(document\.hidden\) \{\s*if \(voice\.busy\) voice\.cancel/);
  assert.match(dashboard, /function deactivate\(\) \{[\s\S]*voice\.cancel/);
  assert.doesNotMatch(dashboard, /speechSynthesis|SpeechSynthesisUtterance|\.speak\s*\(/);
});
