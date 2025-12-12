export interface AudioState {
  buffer: AudioBuffer | null;
  fileName: string;
  duration: number;
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
