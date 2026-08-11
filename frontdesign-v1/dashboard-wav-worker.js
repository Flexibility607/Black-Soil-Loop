export const TARGET_SAMPLE_RATE = 16_000;

export function mergePcmChunks(chunks = []) {
  const normalized = chunks.map((chunk) => (
    chunk instanceof Float32Array ? chunk : new Float32Array(chunk)
  ));
  const length = normalized.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  normalized.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

export function resampleMono(input, sourceSampleRate, targetSampleRate = TARGET_SAMPLE_RATE) {
  if (!(input instanceof Float32Array) || input.length === 0) return new Float32Array();
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) throw new Error('录音采样率无效。');
  if (sourceSampleRate === targetSampleRate) return input.slice();
  const targetLength = Math.max(1, Math.round(input.length * targetSampleRate / sourceSampleRate));
  const output = new Float32Array(targetLength);
  const scale = input.length / targetLength;
  if (sourceSampleRate > targetSampleRate) {
    // A box-filtered, area-weighted reduction avoids the worst high-frequency aliasing
    // produced by selecting or linearly interpolating a single source sample.
    for (let index = 0; index < targetLength; index += 1) {
      const start = index * scale;
      const end = Math.min(input.length, (index + 1) * scale);
      let weightedSum = 0;
      let totalWeight = 0;
      for (let sourceIndex = Math.floor(start); sourceIndex < Math.ceil(end); sourceIndex += 1) {
        const overlap = Math.max(0, Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex));
        if (!overlap || sourceIndex >= input.length) continue;
        weightedSum += input[sourceIndex] * overlap;
        totalWeight += overlap;
      }
      output[index] = totalWeight ? weightedSum / totalWeight : 0;
    }
    return output;
  }
  for (let index = 0; index < targetLength; index += 1) {
    const position = Math.min(input.length - 1, index * scale);
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const weight = position - left;
    output[index] = input[left] + ((input[right] - input[left]) * weight);
  }
  return output;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

export function encodePcm16Wav(chunks, sourceSampleRate, targetSampleRate = TARGET_SAMPLE_RATE, maxSeconds = 30) {
  const resampled = resampleMono(mergePcmChunks(chunks), sourceSampleRate, targetSampleRate);
  const maximumSamples = Math.max(1, Math.floor(targetSampleRate * maxSeconds));
  const samples = resampled.length > maximumSamples ? resampled.subarray(0, maximumSamples) : resampled;
  if (!samples.length) throw new Error('录音内容为空，请重试。');
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + (index * 2), sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return {
    buffer,
    durationSeconds: samples.length / targetSampleRate,
    sampleRate: targetSampleRate,
    channels: 1,
    bitsPerSample: 16,
  };
}

const isDedicatedWorker = typeof WorkerGlobalScope !== 'undefined'
  && globalThis instanceof WorkerGlobalScope;

if (isDedicatedWorker) {
  globalThis.addEventListener('message', (event) => {
    if (event.data?.type !== 'encode') return;
    try {
      const encoded = encodePcm16Wav(event.data.chunks || [], Number(event.data.sampleRate));
      globalThis.postMessage({ type: 'encoded', requestId: event.data.requestId, ...encoded }, [encoded.buffer]);
    } catch (error) {
      globalThis.postMessage({
        type: 'error',
        requestId: event.data.requestId,
        message: error?.message || '无法整理录音。',
      });
    }
  });
}
