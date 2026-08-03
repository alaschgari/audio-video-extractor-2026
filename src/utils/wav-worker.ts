import { encodeWavPCM16 } from './audioHelper';

/**
 * Web Worker for WAV Encoding to avoid blocking the main UI thread.
 * Reuses the exact same encoder as the main-thread bufferToWav (audioHelper.ts)
 * by serializing the function body into the worker via toString().
 */
export const runWavWorker = (
  channelData: Float32Array[],
  sampleRate: number
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const encodeWavPCM16 = ${encodeWavPCM16.toString()};
      self.onmessage = function(e) {
        const { channelData, sampleRate } = e.data;
        const arrayBuffer = encodeWavPCM16(channelData, sampleRate);
        self.postMessage(arrayBuffer, [arrayBuffer]);
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    let worker: Worker;

    try {
      worker = new Worker(workerUrl);
    } catch (err) {
      URL.revokeObjectURL(workerUrl);
      reject(err);
      return;
    }

    worker.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const wavBlob = new Blob([e.data], { type: 'audio/wav' });
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve(wavBlob);
    };

    worker.onerror = (e) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(new Error(e.message || 'Wav worker error'));
    };

    // Transfer buffers to avoid copy overhead
    const buffers = channelData.map(ch => ch.buffer);
    worker.postMessage({ channelData, sampleRate }, buffers);
  });
};
