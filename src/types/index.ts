export type ExportFormat = 'wav' | 'mp4';

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
