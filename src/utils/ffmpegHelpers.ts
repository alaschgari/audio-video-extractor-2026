export const EXPORT_FORMATS = ['wav', 'flac', 'mp3', 'mp4'] as const;
export type AllowedExportFormat = typeof EXPORT_FORMATS[number];

export const isAllowedExportFormat = (value: unknown): value is AllowedExportFormat =>
  typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value);

export const MIME_TYPE_BY_FORMAT: Record<AllowedExportFormat, string> = {
  wav: 'audio/wav',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

/**
 * Builds the shared ffmpeg audio filter chain (volume + fade in/out) used by
 * both the server route (fluent-ffmpeg) and the client ffmpeg.wasm exports.
 */
export const buildAudioFilters = (
  volume: number,
  fadeIn: number,
  fadeOut: number,
  duration: number
): string[] => {
  const filters: string[] = [];

  if (volume !== 1) {
    filters.push(`volume=${volume}`);
  }

  if (fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  }

  if (fadeOut > 0) {
    const fadeOutStart = Math.max(0, duration - fadeOut);
    filters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
  }

  return filters;
};
