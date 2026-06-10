/**
 * Web Worker for WAV Encoding to avoid blocking the main UI thread.
 */
export const runWavWorker = (
  channelData: Float32Array[],
  sampleRate: number
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const workerCode = `
      self.onmessage = function(e) {
        const { channelData, sampleRate } = e.data;
        const numChannels = channelData.length;
        const length = channelData[0].length;
        const format = 1; // PCM
        const bitDepth = 16;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const dataSize = length * blockAlign;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;
        const arrayBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(arrayBuffer);

        function writeString(view, offset, string) {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        }

        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');

        // fmt chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);

        // data chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        let offset = 44;
        for (let i = 0; i < length; i++) {
          for (let ch = 0; ch < numChannels; ch++) {
            const sample = channelData[ch][i];
            const s = sample < -1 ? -1 : sample > 1 ? 1 : sample;
            const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
          }
        }

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
