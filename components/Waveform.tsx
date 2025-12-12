import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SelectionRange } from '../types';
import { formatTime } from '../utils/audioHelper';

interface WaveformProps {
  audioBuffer: AudioBuffer;
  selection: SelectionRange;
  currentTime: number;
  onSelectionChange: (range: SelectionRange) => void;
  onSeek: (time: number) => void;
}

const Waveform: React.FC<WaveformProps> = ({
  audioBuffer,
  selection,
  currentTime,
  onSelectionChange,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Interaction State
  const [dragMode, setDragMode] = useState<'start' | 'end' | 'create' | 'seek' | null>(null);
  const [dragAnchor, setDragAnchor] = useState<number>(0);
  const [hoverTarget, setHoverTarget] = useState<'start' | 'end' | 'selection' | null>(null);
  
  const dragStartPosRef = useRef<{x: number, y: number} | null>(null);

  // Constants
  const HANDLE_THRESHOLD_PX = 12;

  const getTimeFromX = useCallback((clientX: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, relativeX / rect.width));
    return percentage * audioBuffer.duration;
  }, [audioBuffer.duration]);

  const getXFromTime = useCallback((time: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    return (time / audioBuffer.duration) * rect.width;
  }, [audioBuffer.duration]);

  // Draw Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { offsetWidth, offsetHeight } = canvas;
    canvas.width = offsetWidth * dpr;
    canvas.height = offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const width = offsetWidth;
    const height = offsetHeight;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);
    
    // Gradient for the waveform
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#38bdf8'); // sky-400
    gradient.addColorStop(1, '#0ea5e9'); // sky-500
    ctx.fillStyle = gradient;

    // Draw bars
    for (let i = 0; i < width; i += 2) { // Skip pixels for bar effect
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      
      const barHeight = Math.max(2, (max - min) * amp);
      const y = (1 + min) * amp;
      
      // Rounded caps logic
      ctx.beginPath();
      ctx.roundRect(i, y, 1.5, barHeight, 10); 
      ctx.fill();
    }
    
    // Center line
    ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
    ctx.fillRect(0, height/2 - 0.5, width, 1);

  }, [audioBuffer]);

  // Handle Hover Effects (Cursor)
  const handleMouseMoveLocal = (e: React.MouseEvent) => {
    if (dragMode) return;
    
    const mouseX = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const startX = getXFromTime(selection.start);
    const endX = getXFromTime(selection.end);

    if (Math.abs(mouseX - startX) < HANDLE_THRESHOLD_PX) {
      setHoverTarget('start');
    } else if (Math.abs(mouseX - endX) < HANDLE_THRESHOLD_PX) {
      setHoverTarget('end');
    } else if (mouseX > startX && mouseX < endX) {
      setHoverTarget('selection');
    } else {
      setHoverTarget(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const time = getTimeFromX(e.clientX);
    const mouseX = e.clientX - containerRef.current.getBoundingClientRect().left;
    
    const startX = getXFromTime(selection.start);
    const endX = getXFromTime(selection.end);

    if (Math.abs(mouseX - startX) < HANDLE_THRESHOLD_PX) {
      setDragMode('start');
    } else if (Math.abs(mouseX - endX) < HANDLE_THRESHOLD_PX) {
      setDragMode('end');
    } else {
      setDragMode('seek');
      setDragAnchor(time);
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      onSeek(time);
    }
  };

  const handleMouseMoveGlobal = useCallback((e: MouseEvent) => {
    if (!dragMode) return;
    
    const time = getTimeFromX(e.clientX);

    if (dragMode === 'start') {
      const newStart = Math.min(time, selection.end - 0.1);
      onSelectionChange({ ...selection, start: Math.max(0, newStart) });
    } else if (dragMode === 'end') {
      const newEnd = Math.max(time, selection.start + 0.1);
      onSelectionChange({ ...selection, end: Math.min(audioBuffer.duration, newEnd) });
    } else if (dragMode === 'seek') {
      if (dragStartPosRef.current) {
        const dist = Math.abs(e.clientX - dragStartPosRef.current.x);
        if (dist > 5) { // Lower threshold for responsiveness
          setDragMode('create');
          const start = Math.min(dragAnchor, time);
          const end = Math.max(dragAnchor, time);
          onSelectionChange({ start, end });
        } else {
          onSeek(time);
        }
      }
    } else if (dragMode === 'create') {
      const start = Math.min(dragAnchor, time);
      const end = Math.max(dragAnchor, time);
      onSelectionChange({ start, end });
    }
  }, [dragMode, dragAnchor, selection, audioBuffer, getTimeFromX, onSelectionChange, onSeek]);

  const handleMouseUpGlobal = useCallback(() => {
    setDragMode(null);
    dragStartPosRef.current = null;
  }, []);

  useEffect(() => {
    if (dragMode) {
      window.addEventListener('mousemove', handleMouseMoveGlobal);
      window.addEventListener('mouseup', handleMouseUpGlobal);
      return () => {
        window.removeEventListener('mousemove', handleMouseMoveGlobal);
        window.removeEventListener('mouseup', handleMouseUpGlobal);
      };
    }
  }, [dragMode, handleMouseMoveGlobal, handleMouseUpGlobal]);

  const getCursor = () => {
    if (dragMode === 'start' || hoverTarget === 'start') return 'col-resize';
    if (dragMode === 'end' || hoverTarget === 'end') return 'col-resize';
    if (dragMode === 'create') return 'crosshair';
    if (!hoverTarget && !dragMode) return 'crosshair'; 
    return 'default';
  };

  const widthPercent = (time: number) => (time / audioBuffer.duration) * 100;

  return (
    <div 
      ref={containerRef}
      className="relative h-48 w-full bg-slate-900/40 rounded-xl overflow-hidden ring-1 ring-slate-800 select-none group"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMoveLocal}
      onMouseLeave={() => setHoverTarget(null)}
      style={{ cursor: getCursor() }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-80" />

      {/* Selected Region Highlight - "Lit up" area */}
      <div 
        className="absolute top-0 h-full bg-brand-500/10 pointer-events-none transition-all duration-75"
        style={{
          left: `${widthPercent(selection.start)}%`,
          width: `${widthPercent(selection.end - selection.start)}%`
        }}
      />

      {/* Dimmed Areas - "Focus" effect */}
      <div 
        className="absolute top-0 left-0 h-full bg-slate-950/70 pointer-events-none backdrop-grayscale-[50%]"
        style={{ width: `${widthPercent(selection.start)}%` }}
      />
      <div 
        className="absolute top-0 right-0 h-full bg-slate-950/70 pointer-events-none backdrop-grayscale-[50%]"
        style={{ width: `${100 - widthPercent(selection.end)}%` }}
      />

      {/* Playhead */}
      <div 
        className="absolute top-0 h-full w-[2px] bg-red-500 pointer-events-none z-30 shadow-[0_0_15px_rgba(239,68,68,1)]"
        style={{ left: `${widthPercent(currentTime)}%` }}
      />

      {/* Handles */}
      <div 
        className={`absolute top-0 bottom-0 w-6 -ml-3 z-20 flex items-center justify-center group/handle ${hoverTarget === 'start' ? 'cursor-col-resize' : ''}`}
        style={{ left: `${widthPercent(selection.start)}%` }}
      >
        <div className={`w-[2px] h-full bg-brand-400 shadow-[0_0_10px_rgba(56,189,248,0.5)] ${hoverTarget === 'start' || dragMode === 'start' ? 'bg-white' : ''}`} />
        <div className={`absolute -top-3 px-2 py-0.5 rounded bg-brand-600 text-[10px] font-mono font-medium text-white shadow-lg transform transition-opacity duration-200 ${dragMode === 'start' || hoverTarget === 'start' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
           {formatTime(selection.start)}
        </div>
      </div>

      <div 
        className={`absolute top-0 bottom-0 w-6 -ml-3 z-20 flex items-center justify-center group/handle ${hoverTarget === 'end' ? 'cursor-col-resize' : ''}`}
        style={{ left: `${widthPercent(selection.end)}%` }}
      >
         <div className={`w-[2px] h-full bg-brand-400 shadow-[0_0_10px_rgba(56,189,248,0.5)] ${hoverTarget === 'end' || dragMode === 'end' ? 'bg-white' : ''}`} />
         <div className={`absolute -bottom-3 px-2 py-0.5 rounded bg-brand-600 text-[10px] font-mono font-medium text-white shadow-lg transform transition-opacity duration-200 ${dragMode === 'end' || hoverTarget === 'end' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
           {formatTime(selection.end)}
        </div>
      </div>

    </div>
  );
};

export default Waveform;