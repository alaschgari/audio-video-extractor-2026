export type ExportFormat = 'wav' | 'mp4';

export interface AudioState {
  buffer: AudioBuffer | null;
  fileName: string;
  duration: number;
  filePath?: string; // Original file path for backend processing
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
