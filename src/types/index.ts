export type ExportFormat = 'wav' | 'mp4' | 'flac' | 'mp3';

export interface AudioSettings {
  bitrate: string;
  sampleRate: string;
  channels: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface AudioState {
  buffer: AudioBuffer | null;
  fileName: string;
  duration: number;
  file: File;
  filePath?: string; // Original file path (not used in web, kept for compatibility if needed)
}

export interface ProcessingState {
  isProcessing: boolean;
  message: string;
  progress: number;
}

export interface SelectionRange {
  start: number;
  end: number;
}
