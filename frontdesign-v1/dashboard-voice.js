import { encodePcm16Wav } from './dashboard-wav-worker.js?v=20260814-dashboard-presentation-5';

export const VOICE_STATES = Object.freeze({
  IDLE: 'idle',
  REQUESTING: 'requesting',
  RECORDING: 'recording',
  UPLOADING: 'uploading',
  TRANSCRIBING: 'transcribing',
  ANALYZING: 'analyzing',
  DONE: 'done',
  ERROR: 'error',
  CANCELLED: 'cancelled',
});

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 30;
export const TARGET_SAMPLE_RATE = 16_000;

const BUSY_STATES = new Set([
  VOICE_STATES.REQUESTING,
  VOICE_STATES.RECORDING,
  VOICE_STATES.UPLOADING,
  VOICE_STATES.TRANSCRIBING,
  VOICE_STATES.ANALYZING,
]);

export function validateAudio(blob, durationSeconds) {
  if (!blob || !blob.size) throw new Error('录音内容为空，请重试。');
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('录音超过 2 MiB，请缩短问题。');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('录音时长无效，请重试。');
  if (durationSeconds > MAX_AUDIO_SECONDS) throw new Error('录音超过 30 秒，请缩短问题。');
}

export function createRequestId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function prepareAudioContext(options = {}) {
  const AudioContextClass = options.AudioContextClass
    || globalThis.AudioContext
    || globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持音频采集，请改用文字提问。');
  const context = new AudioContextClass();
  if (context.state === 'suspended') await context.resume().catch(() => {});
  if (context.state === 'suspended') {
    await context.close().catch(() => {});
    throw new Error('浏览器暂未允许音频采集，请再次点击麦克风或改用文字提问。');
  }
  return context;
}

function abortError() {
  const error = new Error('本次提问已取消。');
  error.name = 'AbortError';
  return error;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function createPcmCaptureSession(stream, options = {}) {
  const AudioContextClass = options.AudioContextClass
    || globalThis.AudioContext
    || globalThis.webkitAudioContext;
  const AudioWorkletNodeClass = options.AudioWorkletNodeClass || globalThis.AudioWorkletNode;
  if (!options.context && !AudioContextClass) throw new Error('当前浏览器不支持音频采集，请改用文字提问。');

  const context = options.context || new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  const silence = context.createGain();
  silence.gain.value = 0;
  silence.connect(context.destination);
  const chunks = [];
  let node = null;
  let mode = 'script-processor';
  let released = false;
  let workletStopped = null;

  const disconnectAndClose = async () => {
    if (released) return;
    released = true;
    try { source.disconnect(); } catch {}
    try { node?.disconnect(); } catch {}
    try { silence.disconnect(); } catch {}
    if (node && 'onaudioprocess' in node) node.onaudioprocess = null;
    if (context.state !== 'closed') await context.close().catch(() => {});
  };

  if (context.state === 'suspended') await context.resume().catch(() => {});

  if (context.audioWorklet?.addModule && AudioWorkletNodeClass) {
    try {
      const moduleUrl = options.workletModuleUrl
        || new URL('./dashboard-audio-worklet.js?v=20260814-dashboard-presentation-5', import.meta.url).href;
      await context.audioWorklet.addModule(moduleUrl);
      node = new AudioWorkletNodeClass(context, 'black-soil-pcm-recorder');
      let resolveStopped;
      workletStopped = new Promise((resolve) => { resolveStopped = resolve; });
      node.port.onmessage = (event) => {
        if (event.data?.type === 'samples') chunks.push(new Float32Array(event.data.samples));
        if (event.data?.type === 'stopped') resolveStopped();
      };
      node.port.start?.();
      source.connect(node);
      node.connect(silence);
      mode = 'audio-worklet';
    } catch {
      try { node?.disconnect(); } catch {}
      node = null;
    }
  }

  if (!node) {
    if (typeof context.createScriptProcessor !== 'function') {
      await disconnectAndClose();
      throw new Error('当前浏览器无法启动录音，请改用文字提问。');
    }
    node = context.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => {
      const channel = event.inputBuffer?.getChannelData?.(0);
      if (channel?.length) chunks.push(new Float32Array(channel));
    };
    source.connect(node);
    node.connect(silence);
  }

  return {
    mode,
    sampleRate: context.sampleRate,
    async stop() {
      if (released) return { chunks: [], sampleRate: context.sampleRate, mode };
      if (mode === 'audio-worklet') {
        node.port.postMessage({ type: 'stop' });
        await Promise.race([workletStopped, wait(250)]);
      }
      const result = { chunks: chunks.slice(), sampleRate: context.sampleRate, mode };
      await disconnectAndClose();
      return result;
    },
    release: disconnectAndClose,
  };
}

export function encodeWavInWorker(chunks, sampleRate, { requestId, signal, WorkerClass = globalThis.Worker } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (!WorkerClass) return Promise.resolve(encodePcm16Wav(chunks, sampleRate));

  let worker;
  try {
    worker = new WorkerClass(
      new URL('./dashboard-wav-worker.js?v=20260814-dashboard-presentation-5', import.meta.url),
      { type: 'module', name: 'blacksoil-wav-encoder' },
    );
  } catch {
    return Promise.resolve(encodePcm16Wav(chunks, sampleRate));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener?.('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    worker.addEventListener('error', () => {
      cleanup();
      reject(new Error('无法整理录音，请改用文字提问。'));
    }, { once: true });
    worker.addEventListener('message', (event) => {
      if (event.data?.requestId !== requestId) return;
      cleanup();
      if (event.data.type === 'error') reject(new Error(event.data.message));
      else resolve(event.data);
    });
    const transferableChunks = chunks.map((chunk) => (
      chunk instanceof Float32Array ? chunk : new Float32Array(chunk)
    ));
    worker.postMessage({
      type: 'encode',
      requestId,
      sampleRate,
      chunks: transferableChunks.map((chunk) => chunk.buffer),
    }, transferableChunks.map((chunk) => chunk.buffer));
  });
}

export class VoiceQuestionController {
  constructor({
    api,
    onState,
    onTranscript,
    onAnswer,
    onFallback,
    mediaDevices = globalThis.navigator?.mediaDevices,
    captureFactory = createPcmCaptureSession,
    wavEncoder = encodeWavInWorker,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    timers = globalThis,
    prepareContext = null,
  }) {
    this.api = api;
    this.onState = onState;
    this.onTranscript = onTranscript;
    this.onAnswer = onAnswer;
    this.onFallback = onFallback;
    this.mediaDevices = mediaDevices;
    this.captureFactory = captureFactory;
    this.wavEncoder = wavEncoder;
    this.now = now;
    this.timers = timers;
    this.prepareContext = prepareContext
      || (captureFactory === createPcmCaptureSession ? prepareAudioContext : async () => null);
    this.state = VOICE_STATES.IDLE;
    this.activeRound = null;
    this.lastQuestion = '';
  }

  get busy() {
    return BUSY_STATES.has(this.state) && Boolean(this.activeRound);
  }

  setState(state, detail = '') {
    this.state = state;
    this.onState?.(state, detail);
  }

  isCurrent(round) {
    return Boolean(round) && this.activeRound === round && !round.cancelled;
  }

  clearTimers(round) {
    this.timers.clearTimeout?.(round?.timeoutId);
    this.timers.clearInterval?.(round?.countdownId);
    if (round) {
      round.timeoutId = null;
      round.countdownId = null;
    }
  }

  async toggle(period, parkId) {
    if (this.state === VOICE_STATES.RECORDING) return this.stop(period, parkId);
    if (this.busy) return undefined;
    return this.start(period, parkId);
  }

  async start(period = '30d', parkId = null) {
    if (!this.mediaDevices?.getUserMedia) {
      this.fail(new Error('当前浏览器不支持麦克风录音，请改用文字提问。'));
      return;
    }
    if (this.activeRound) this.cancel('', false);
    const round = {
      id: createRequestId(),
      period,
      parkId,
      controller: new AbortController(),
      stream: null,
      capture: null,
      preparedContext: null,
      startedAt: 0,
      cancelled: false,
      stopping: false,
      timeoutId: null,
      countdownId: null,
    };
    this.activeRound = round;
    this.setState(VOICE_STATES.REQUESTING, '正在请求麦克风权限');
    try {
      // Create/resume the AudioContext before the first permission await so iOS Safari
      // observes the original microphone-button user activation.
      round.preparedContext = await this.prepareContext();
      if (!this.isCurrent(round)) {
        await this.closePreparedContext(round);
        return;
      }
      round.stream = await this.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.isCurrent(round)) {
        await this.closePreparedContext(round);
        round.stream.getTracks?.().forEach((track) => track.stop());
        return;
      }
      round.capture = await this.captureFactory(round.stream, { context: round.preparedContext });
      round.preparedContext = null;
      if (!this.isCurrent(round)) {
        await round.capture.release?.();
        round.stream.getTracks?.().forEach((track) => track.stop());
        return;
      }
      round.startedAt = this.now();
      const updateCountdown = () => {
        if (!this.isCurrent(round) || this.state !== VOICE_STATES.RECORDING) return;
        const elapsed = Math.max(0, (this.now() - round.startedAt) / 1000);
        const remaining = Math.max(0, Math.ceil(MAX_AUDIO_SECONDS - elapsed));
        this.setState(VOICE_STATES.RECORDING, `录音中，剩余 ${remaining} 秒；再次点击结束`);
      };
      this.setState(VOICE_STATES.RECORDING, `录音中，剩余 ${MAX_AUDIO_SECONDS} 秒；再次点击结束`);
      round.countdownId = this.timers.setInterval(updateCountdown, 1000);
      round.timeoutId = this.timers.setTimeout(() => this.stop(period, parkId, round), MAX_AUDIO_SECONDS * 1000);
    } catch (error) {
      if (!this.isCurrent(round)) return;
      const messages = {
        NotAllowedError: '麦克风权限被拒绝，请在浏览器设置中允许后重试。',
        NotFoundError: '没有检测到可用麦克风，请连接设备后重试。',
        NotReadableError: '麦克风正被其他程序占用，请关闭占用程序后重试。',
      };
      this.fail(new Error(messages[error?.name] || `无法开始录音：${error?.message || error}`), round);
    }
  }

  async stop(period, parkId, requestedRound = this.activeRound) {
    const round = requestedRound;
    if (!this.isCurrent(round) || round.stopping || !round.capture) return;
    round.stopping = true;
    this.clearTimers(round);
    this.setState(VOICE_STATES.UPLOADING, '录音已结束，正在整理为 16 kHz WAV');
    try {
      const captured = await round.capture.stop();
      round.capture = null;
      this.stopTracks(round);
      if (!this.isCurrent(round)) return;
      const encoded = await this.wavEncoder(captured.chunks, captured.sampleRate, {
        requestId: round.id,
        signal: round.controller.signal,
      });
      if (!this.isCurrent(round)) return;
      const blob = new Blob([encoded.buffer], { type: 'audio/wav' });
      const durationSeconds = Number(encoded.durationSeconds);
      validateAudio(blob, durationSeconds);
      await this.upload(round, blob, durationSeconds, period || round.period, parkId ?? round.parkId);
    } catch (error) {
      if (error?.name !== 'AbortError' && this.isCurrent(round)) this.fail(this.normalizeFailure(error), round);
    }
  }

  cancel(detail = '已取消本次提问', updateState = true) {
    const round = this.activeRound;
    if (!round) return false;
    round.cancelled = true;
    this.clearTimers(round);
    round.controller.abort();
    round.capture?.release?.();
    round.capture = null;
    this.closePreparedContext(round);
    this.stopTracks(round);
    this.activeRound = null;
    if (updateState) this.setState(VOICE_STATES.CANCELLED, detail);
    return true;
  }

  async upload(round, blob, durationSeconds, period, parkId) {
    try {
      this.setState(VOICE_STATES.TRANSCRIBING, '正在通过阿里云智能语音交互识别');
      const transcription = await this.api.transcribeDashboardAudio(blob, durationSeconds, 'question.wav', {
        requestId: round.id,
        signal: round.controller.signal,
      });
      if (!this.isCurrent(round)) return;
      if (!transcription.ok) throw new Error(this.apiError(transcription));
      const question = String(
        transcription.json?.data?.text
          || transcription.json?.data?.transcript
          || transcription.json?.transcript
          || '',
      ).trim();
      if (!question) throw new Error('没有识别到有效问题，请靠近麦克风重试。');
      this.lastQuestion = question;
      this.onTranscript?.(question);
      this.setState(VOICE_STATES.ANALYZING, '正在按当前统计周期分析园区数据');
      const answer = await this.api.queryDashboardAssistant(question, period, parkId, null, {
        requestId: round.id,
        signal: round.controller.signal,
      });
      if (!this.isCurrent(round)) return;
      if (!answer.ok) throw new Error(this.apiError(answer));
      this.onAnswer?.(answer.json?.data);
      this.setState(VOICE_STATES.DONE, '回答完成');
      this.activeRound = null;
    } catch (error) {
      if (error?.name !== 'AbortError' && this.isCurrent(round)) this.fail(this.normalizeFailure(error), round);
    }
  }

  apiError(result) {
    const body = result?.json || {};
    const code = body.code || body.detail?.code || body.errors?.[0]?.code;
    const messages = {
      AUDIO_TOO_LARGE: '录音超过 2 MiB，请缩短问题后重试。',
      AUDIO_TYPE_NOT_ALLOWED: '录音格式不受支持，请刷新页面后重试。',
      AUDIO_INVALID: '录音内容无效，请靠近麦克风重新录制。',
      VOICE_RATE_LIMITED: '语音使用较频繁，请稍后再试，文字提问仍可使用。',
      VOICE_CONCURRENCY_EXCEEDED: '当前语音请求较多，请稍后再试，文字提问仍可使用。',
      VOICE_DAILY_BUDGET_EXHAUSTED: '今日语音额度已用完，请使用文字提问。',
      TRANSCRIPTION_FAILED: '语音识别暂时不可用，请使用文字提问。',
      TRANSCRIPTION_EMPTY: '没有识别到有效问题，请靠近麦克风重试。',
      TRANSCRIPTION_NOT_CONFIGURED: '语音服务尚未配置，请使用文字提问。',
      VOICE_DISABLED: '语音功能暂未开放，请使用文字提问。',
    };
    return messages[code]
      || (result?.status === 401 ? '登录会话已过期，请重新登录或使用公开文字提问。' : null)
      || (result?.status === 429 ? '当前请求较多，请稍后再试，文字提问仍可使用。' : null)
      || (result?.status >= 500 ? '语音服务暂时不可用，请使用文字提问。' : null)
      || '请求未完成，请稍后重试或使用文字提问。';
  }

  normalizeFailure(error) {
    const message = String(error?.message || error || '');
    if (error?.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      return new Error('网络连接失败，请检查网络后重试，文字和预设问题仍可使用。');
    }
    return error instanceof Error ? error : new Error(message || '语音请求未完成，请使用文字提问。');
  }

  fail(error, round = this.activeRound) {
    if (round && !this.isCurrent(round)) return;
    if (round) {
      this.clearTimers(round);
      round.controller.abort();
      round.capture?.release?.();
      round.capture = null;
      this.closePreparedContext(round);
      this.stopTracks(round);
    }
    this.activeRound = null;
    const detail = error?.message || String(error);
    this.setState(VOICE_STATES.ERROR, detail);
    this.onFallback?.(detail);
  }

  stopTracks(round) {
    round?.stream?.getTracks?.().forEach((track) => track.stop());
    if (round) round.stream = null;
  }

  async closePreparedContext(round) {
    const context = round?.preparedContext;
    if (!context) return;
    round.preparedContext = null;
    if (context.state !== 'closed') await context.close?.().catch(() => {});
  }
}
