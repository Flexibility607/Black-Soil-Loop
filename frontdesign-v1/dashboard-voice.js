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

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 30;

export function preferredRecorderMime(MediaRecorderClass = globalThis.MediaRecorder) {
  if (!MediaRecorderClass) return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find((type) => MediaRecorderClass.isTypeSupported?.(type)) || '';
}

export function extensionForMime(mime = '') {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'webm';
}

export function validateAudio(blob, durationSeconds) {
  if (!blob || !blob.size) throw new Error('录音内容为空，请重试。');
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('录音超过 5 MiB，请缩短问题。');
  if (durationSeconds > MAX_AUDIO_SECONDS + 0.5) throw new Error('录音超过 30 秒，请缩短问题。');
}

export class VoiceQuestionController {
  constructor({ api, onState, onTranscript, onAnswer }) {
    this.api = api;
    this.onState = onState;
    this.onTranscript = onTranscript;
    this.onAnswer = onAnswer;
    this.state = VOICE_STATES.IDLE;
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
    this.timeoutId = null;
    this.cancelled = false;
    this.lastQuestion = '';
  }

  setState(state, detail = '') {
    this.state = state;
    this.onState?.(state, detail);
  }

  async toggle(period, parkId) {
    if (this.state === VOICE_STATES.RECORDING) return this.stop(period, parkId);
    if ([VOICE_STATES.REQUESTING, VOICE_STATES.UPLOADING, VOICE_STATES.TRANSCRIBING, VOICE_STATES.ANALYZING].includes(this.state)) return;
    return this.start(period, parkId);
  }

  async start(period, parkId) {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      this.fail(new Error('当前浏览器不支持录音，请使用最新版 Chrome 或 Edge。'));
      return;
    }
    this.cancelled = false;
    this.setState(VOICE_STATES.REQUESTING, '正在请求麦克风权限');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredRecorderMime();
      this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
      this.chunks = [];
      this.recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) this.chunks.push(event.data); });
      this.recorder.addEventListener('stop', () => this.upload(period, parkId));
      this.startedAt = performance.now();
      this.recorder.start(250);
      this.timeoutId = setTimeout(() => this.stop(period, parkId), MAX_AUDIO_SECONDS * 1000);
      this.setState(VOICE_STATES.RECORDING, '录音中，再次点击结束');
    } catch (error) {
      this.fail(new Error(error?.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器设置中允许后重试。' : `无法开始录音：${error.message || error}`));
    }
  }

  stop(period, parkId) {
    if (this.recorder?.state === 'recording') {
      clearTimeout(this.timeoutId);
      this.setState(VOICE_STATES.UPLOADING, '录音完成，准备上传');
      this.recorder.stop();
    }
  }

  cancel() {
    this.cancelled = true;
    clearTimeout(this.timeoutId);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.release();
    this.setState(VOICE_STATES.CANCELLED, '已取消本次提问');
  }

  async upload(period, parkId) {
    const durationSeconds = Math.min(MAX_AUDIO_SECONDS, Math.max(0, (performance.now() - this.startedAt) / 1000));
    const mimeType = this.recorder?.mimeType || this.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    this.release();
    if (this.cancelled) return;
    try {
      validateAudio(blob, durationSeconds);
      this.setState(VOICE_STATES.TRANSCRIBING, '正在转写语音');
      const transcription = await this.api.transcribeDashboardAudio(blob, durationSeconds, `question.${extensionForMime(mimeType)}`);
      if (this.cancelled) return;
      if (!transcription.ok) throw new Error(this.apiError(transcription));
      const question = transcription.json?.data?.text?.trim();
      if (!question) throw new Error('没有识别到有效问题，请靠近麦克风重试。');
      this.lastQuestion = question;
      this.onTranscript?.(question);
      this.setState(VOICE_STATES.ANALYZING, '正在分析园区数据');
      const answer = await this.api.queryDashboardAssistant(question, period, parkId);
      if (this.cancelled) return;
      if (!answer.ok) throw new Error(this.apiError(answer));
      this.onAnswer?.(answer.json?.data);
      this.setState(VOICE_STATES.DONE, '回答完成');
    } catch (error) {
      this.fail(error);
    }
  }

  apiError(result) {
    const body = result?.json;
    return body?.errors?.[0]?.message || body?.detail?.message || body?.message || `请求失败（HTTP ${result?.status || '未知'}）`;
  }

  fail(error) {
    this.release();
    this.setState(VOICE_STATES.ERROR, error?.message || String(error));
  }

  release() {
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
