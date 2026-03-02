"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SelectionRange } from '@/types';
import { formatTime } from '@/utils/audioHelper';

interface WaveformProps {
    audioBuffer: AudioBuffer;
    selection: SelectionRange;
    currentTime: number;
    fadeIn: number;
    fadeOut: number;
    onSelectionChange: (range: SelectionRange) => void;
    onSeek: (time: number) => void;
}

const Waveform: React.FC<WaveformProps> = ({
    audioBuffer,
    selection,
    currentTime,
    fadeIn,
    fadeOut,
    onSelectionChange,
    onSeek,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Interaction State
    const [dragMode, setDragMode] = useState<'start' | 'end' | 'create' | 'seek' | null>(null);
    const [dragAnchor, setDragAnchor] = useState<number>(0);
    const [hoverTarget, setHoverTarget] = useState<'start' | 'end' | 'selection' | null>(null);

    const dragStartPosRef = useRef<{ x: number, y: number } | null>(null);

    // Constants
    const HANDLE_THRESHOLD_PX = 24; // Increased for better touch targets

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

    // Caching Bars for Performance
    const barsCacheRef = useRef<{ width: number; bars: { y: number; h: number }[] } | null>(null);

    // Draw Waveform
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !audioBuffer) return;

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const updateCanvasSize = () => {
            const dpr = window.devicePixelRatio || 1;
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;

            if (width === 0 || height === 0) return;

            if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
                canvas.width = width * dpr;
                canvas.height = height * dpr;
                ctx.scale(dpr, dpr);
            }

            // Recalculate base bars if width changed or cache is empty
            if (!barsCacheRef.current || barsCacheRef.current.width !== width) {
                const data = audioBuffer.getChannelData(0);
                const step = Math.ceil(data.length / width);
                const amp = height / 2;
                const bars = [];

                for (let i = 0; i < width; i += 2) {
                    let min = 1.0;
                    let max = -1.0;
                    const startIdx = Math.floor(i * step);
                    const endIdx = Math.min(data.length, startIdx + step);

                    for (let j = startIdx; j < endIdx; j++) {
                        const datum = data[j];
                        if (datum < min) min = datum;
                        if (datum > max) max = datum;
                    }
                    const barHeight = Math.max(2, (max - min) * amp);
                    const y = (1 + min) * amp;
                    bars.push({ y, h: barHeight });
                }
                barsCacheRef.current = { width, bars };
            }

            ctx.clearRect(0, 0, width, height);

            const { bars } = barsCacheRef.current;
            const duration = audioBuffer.duration;

            for (let i = 0; i < bars.length; i++) {
                const bar = bars[i];
                const x = i * 2;
                const time = (x / width) * duration;

                let volumeMultiplier = 1.0;

                // Only apply fades within the selected region
                if (time >= selection.start && time <= selection.end) {
                    // Fade In
                    if (fadeIn > 0 && time < selection.start + fadeIn) {
                        volumeMultiplier = (time - selection.start) / fadeIn;
                    }
                    // Fade Out
                    else if (fadeOut > 0 && time > selection.end - fadeOut) {
                        volumeMultiplier = (selection.end - time) / fadeOut;
                    }
                } else {
                    // Outside selection, we can keep it as is or dim it (dimming is handled by separate overlays)
                    volumeMultiplier = 1.0;
                }

                volumeMultiplier = Math.max(0, Math.min(1, volumeMultiplier));

                // Scale height and center
                const scaledH = bar.h * volumeMultiplier;
                const scaledY = bar.y + (bar.h - scaledH) / 2;

                const isSelected = time >= selection.start && time <= selection.end;

                if (isSelected) {
                    ctx.fillStyle = '#38bdf8'; // Brand color for selection
                } else {
                    ctx.fillStyle = '#334155'; // Muted for non-selection
                }

                ctx.beginPath();
                ctx.roundRect(x, scaledY, 1.5, scaledH, 10);
                ctx.fill();
            }

            // Central horizontal line
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fillRect(0, height / 2 - 0.5, width, 1);
        };

        updateCanvasSize();
        window.addEventListener('resize', updateCanvasSize);
        return () => window.removeEventListener('resize', updateCanvasSize);
    }, [audioBuffer, fadeIn, fadeOut, selection]);

    // Handle Hover Effects (Cursor)
    const handleMouseMoveLocal = (e: React.MouseEvent) => {
        if (dragMode) return;

        const mouseX = e.clientX - e.currentTarget.getBoundingClientRect().left;
        const startX = getXFromTime(selection.start);
        const endX = getXFromTime(selection.end);

        if (Math.abs(mouseX - startX) < HANDLE_THRESHOLD_PX / 2) {
            setHoverTarget('start');
        } else if (Math.abs(mouseX - endX) < HANDLE_THRESHOLD_PX / 2) {
            setHoverTarget('end');
        } else if (mouseX > startX && mouseX < endX) {
            setHoverTarget('selection');
        } else {
            setHoverTarget(null);
        }
    };

    const handleStart = (clientX: number, clientY: number) => {
        if (!containerRef.current) return;

        const time = getTimeFromX(clientX);
        const mouseX = clientX - containerRef.current.getBoundingClientRect().left;

        const startX = getXFromTime(selection.start);
        const endX = getXFromTime(selection.end);

        if (Math.abs(mouseX - startX) < HANDLE_THRESHOLD_PX) {
            setDragMode('start');
        } else if (Math.abs(mouseX - endX) < HANDLE_THRESHOLD_PX) {
            setDragMode('end');
        } else {
            setDragMode('seek');
            setDragAnchor(time);
            dragStartPosRef.current = { x: clientX, y: clientY };
            onSeek(time);
        }
    };

    const handleMove = useCallback((clientX: number) => {
        if (!dragMode) return;

        const time = getTimeFromX(clientX);

        if (dragMode === 'start') {
            const newStart = Math.min(time, selection.end - 0.1);
            onSelectionChange({ ...selection, start: Math.max(0, newStart) });
        } else if (dragMode === 'end') {
            const newEnd = Math.max(time, selection.start + 0.1);
            onSelectionChange({ ...selection, end: Math.min(audioBuffer.duration, newEnd) });
        } else if (dragMode === 'seek') {
            if (dragStartPosRef.current) {
                const dist = Math.abs(clientX - dragStartPosRef.current.x);
                if (dist > 5) {
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

    const handleEnd = useCallback(() => {
        setDragMode(null);
        dragStartPosRef.current = null;
    }, []);

    useEffect(() => {
        if (dragMode) {
            const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
            const onTouchMove = (e: TouchEvent) => {
                if (e.touches[0]) handleMove(e.touches[0].clientX);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', handleEnd);
            window.addEventListener('touchmove', onTouchMove, { passive: false });
            window.addEventListener('touchend', handleEnd);

            return () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', handleEnd);
                window.removeEventListener('touchmove', onTouchMove);
                window.removeEventListener('touchend', handleEnd);
            };
        }
    }, [dragMode, handleMove, handleEnd]);

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
            className="relative h-40 sm:h-48 w-full bg-slate-900/40 rounded-xl overflow-hidden ring-1 ring-slate-800 select-none group touch-none"
            onMouseDown={(e) => { e.preventDefault(); handleStart(e.clientX, e.clientY); }}
            onTouchStart={(e) => { e.preventDefault(); if (e.touches[0]) handleStart(e.touches[0].clientX, e.touches[0].clientY); }}
            onMouseMove={handleMouseMoveLocal}
            onMouseLeave={() => setHoverTarget(null)}
            style={{ cursor: getCursor() }}
        >
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-80" />

            {/* Selected Region Highlight */}
            <div
                className="absolute top-0 h-full bg-brand-500/10 pointer-events-none transition-all duration-75"
                style={{
                    left: `${widthPercent(selection.start)}%`,
                    width: `${widthPercent(selection.end - selection.start)}%`
                }}
            />

            {/* Dimmed Areas */}
            <div
                className="absolute top-0 left-0 h-full bg-slate-950/70 pointer-events-none backdrop-grayscale-[50%]"
                style={{ width: `${widthPercent(selection.start)}%` }}
            />
            <div
                className="absolute top-0 right-0 h-full bg-slate-950/70 pointer-events-none backdrop-grayscale-[50%]"
                style={{ width: `${100 - widthPercent(selection.end)}%` }}
            />


            {/* Playhead */}

            {/* Playhead */}
            <div
                className="absolute top-0 h-full w-[2px] bg-red-500 pointer-events-none z-30 shadow-[0_0_15px_rgba(239,68,68,1)]"
                style={{ left: `${widthPercent(currentTime)}%` }}
            />

            {/* Handles */}
            <div
                className={`absolute top-0 bottom-0 w-8 -ml-4 z-20 flex items-center justify-center group/handle ${hoverTarget === 'start' ? 'cursor-col-resize' : ''}`}
                style={{ left: `${widthPercent(selection.start)}%` }}
            >
                <div className={`w-[3px] h-full bg-brand-400 shadow-[0_0_10px_rgba(56,189,248,0.5)] ${hoverTarget === 'start' || dragMode === 'start' ? 'bg-white' : ''}`} />
                <div className={`absolute -top-3 px-2 py-0.5 rounded bg-brand-600 text-[10px] font-mono font-medium text-white shadow-lg transform transition-opacity duration-200 ${dragMode === 'start' || hoverTarget === 'start' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                    {formatTime(selection.start)}
                </div>
            </div>

            <div
                className={`absolute top-0 bottom-0 w-8 -ml-4 z-20 flex items-center justify-center group/handle ${hoverTarget === 'end' ? 'cursor-col-resize' : ''}`}
                style={{ left: `${widthPercent(selection.end)}%` }}
            >
                <div className={`w-[3px] h-full bg-brand-400 shadow-[0_0_10px_rgba(56,189,248,0.5)] ${hoverTarget === 'end' || dragMode === 'end' ? 'bg-white' : ''}`} />
                <div className={`absolute -bottom-3 px-2 py-0.5 rounded bg-brand-600 text-[10px] font-mono font-medium text-white shadow-lg transform transition-opacity duration-200 ${dragMode === 'end' || hoverTarget === 'end' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                    {formatTime(selection.end)}
                </div>
            </div>

        </div>
    );
};

export default Waveform;
