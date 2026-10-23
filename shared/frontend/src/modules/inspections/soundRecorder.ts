/**
 * Records the microphone as a WAV file (16-bit mono), the format the sound service reads. Browsers' own recorder
 * (MediaRecorder) only makes WebM/Ogg-Opus, so the raw samples are collected with the Web Audio API and written as WAV.
 *
 * The browser's voice processing (noise suppression, echo cancellation, automatic volume) is turned off: it is made
 * for speech and would remove exactly the engine and brake sounds the model listens for.
 * Needs a secure page (https or localhost); elsewhere navigator.mediaDevices is missing.
 */
export type Recording = { stop: () => Promise<File>; cancel: () => void };

export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';

export async function startRecording(name: string, onLevel?: (rms: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessorNode is old but works everywhere without a separate worklet file; 4096 samples ≈ 0.1 s per call
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0; // the processor only runs while connected to the output; this keeps the speakers quiet
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e) => {
    const samples = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(samples);
    if (onLevel) onLevel(Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length));
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);

  const close = async () => {
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
  };
  return {
    stop: async () => {
      const rate = context.sampleRate;
      await close();
      return new File([encodeWav(chunks, rate)], name, { type: 'audio/wav' });
    },
    cancel: () => void close(),
  };
}

/** 16-bit PCM mono WAV: a 44-byte header, then the samples. */
export function encodeWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, length * 2, true);
  let at = 44;
  for (const chunk of chunks) {
    for (const v of chunk) {
      const s = Math.max(-1, Math.min(1, v));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return buffer;
}
