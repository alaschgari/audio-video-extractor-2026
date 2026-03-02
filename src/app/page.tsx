"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Play, Pause, Download, Music, X, RotateCcw, FileAudio, Clock, Video, Music as MusicIcon, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { AudioState, ProcessingState, SelectionRange, ExportFormat, AudioSettings } from '@/types';
import { bufferToWav, formatTime, parseTimeString, sliceAudioBuffer } from '@/utils/audioHelper';
import Waveform from '@/components/Waveform';
import Button from '@/components/Button';
import TimeInput from '@/components/TimeInput';
import ProcessingOverlay from '@/components/ProcessingOverlay';

export default function Home() {
  // State
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [processing, setProcessing] = useState<ProcessingState>({ isProcessing: false, message: '', progress: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 });
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    bitrate: '192k',
    sampleRate: '44100',
    channels: '2',
    volume: 1,
    fadeIn: 0,
    fadeOut: 0
  });
  const [showSettings, setShowSettings] = useState(false);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  const rafRef = useRef<number>();

  // Init AudioContext
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => { audioContextRef.current?.close(); };
  }, []);

  // Sync manual inputs
  useEffect(() => {
    setManualStart(formatTime(selection.start));
    setManualEnd(formatTime(selection.end));
  }, [selection]);

  // Playback Loop
  const updateProgress = useCallback(() => {
    if (!isPlaying || !audioContextRef.current) return;
    const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
    const current = startOffsetRef.current + elapsed;

    if (current >= selection.end) {
      stopPlayback();
      setCurrentTime(selection.start);
      startOffsetRef.current = selection.start;
    } else {
      setCurrentTime(current);
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  }, [isPlaying, selection]);

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(updateProgress);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  }, [isPlaying, updateProgress]);

  // Handlers
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopPlayback();
    setAudioState(null);
    setProcessing({ isProcessing: true, message: 'Analysiere Video...', progress: 10 });

    try {
      const arrayBuffer = await file.arrayBuffer();
      setProcessing({ isProcessing: true, message: 'Extrahiere Audio...', progress: 40 });

      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

      setAudioState({
        buffer: audioBuffer,
        fileName: file.name,
        duration: audioBuffer.duration,
        file: file
      });
      setSelection({ start: 0, end: audioBuffer.duration });
      setCurrentTime(0);
      startOffsetRef.current = 0;
      setProcessing({ isProcessing: false, message: '', progress: 100 });
    } catch (error) {
      console.error(error);
      setProcessing({ isProcessing: false, message: 'Fehler beim Laden.', progress: 0 });
      alert('Konnte Audio nicht verarbeiten.');
    }
  };

  const startPlayback = () => {
    if (!audioContextRef.current || !audioState?.buffer) return;
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioState.buffer;

    // Create and configure GainNode for fades and master volume
    const gainNode = audioContextRef.current.createGain();
    const targetVolume = audioSettings.volume;
    const now = audioContextRef.current.currentTime;

    let startPos = currentTime;
    if (startPos >= selection.end || startPos < selection.start) startPos = selection.start;

    // Clear any previous scheduled values
    gainNode.gain.cancelScheduledValues(now);

    // Calculate Fade In
    const fadeInEndTime = selection.start + audioSettings.fadeIn;
    if (startPos < fadeInEndTime) {
      const fadeInRemaining = fadeInEndTime - startPos;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(targetVolume, now + fadeInRemaining);
    } else {
      gainNode.gain.setValueAtTime(targetVolume, now);
    }

    // Calculate Fade Out
    const fadeOutStartTime = selection.end - audioSettings.fadeOut;
    const timeUntilFadeOut = Math.max(0, fadeOutStartTime - startPos);
    const playDuration = selection.end - startPos;

    if (playDuration > 0) {
      if (startPos < fadeOutStartTime) {
        // Schedule fade out start
        gainNode.gain.setValueAtTime(targetVolume, now + timeUntilFadeOut);
        gainNode.gain.linearRampToValueAtTime(0, now + playDuration);
      } else {
        // Already in fade out zone, ramp from current interpolated volume
        const fadeOutProgress = (selection.end - startPos) / audioSettings.fadeOut;
        const currentFadeVolume = targetVolume * Math.max(0, Math.min(1, fadeOutProgress));
        gainNode.gain.setValueAtTime(currentFadeVolume, now);
        gainNode.gain.linearRampToValueAtTime(0, now + playDuration);
      }
    }

    source.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);

    source.start(0, startPos);
    startTimeRef.current = audioContextRef.current.currentTime;
    startOffsetRef.current = startPos;
    sourceNodeRef.current = source;
    setIsPlaying(true);
  };

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch (e) { }
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
    if (audioContextRef.current) {
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      const newTime = Math.min(selection.end, Math.max(selection.start, startOffsetRef.current + elapsed));
      setCurrentTime(newTime);
      startOffsetRef.current = newTime;
    }
  };

  const handleDownload = async () => {
    if (!audioState || !audioContextRef.current) return;

    const cleanName = audioState.fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, '_');
    const defaultName = `${cleanName}_extract.${exportFormat}`;

    setProcessing({ isProcessing: true, message: `Exportiere ${exportFormat.toUpperCase()}...`, progress: 50 });

    try {
      const formData = new FormData();
      formData.append('file', audioState.file);
      formData.append('start', selection.start.toString());
      formData.append('duration', (selection.end - selection.start).toString());
      formData.append('format', exportFormat);
      formData.append('bitrate', audioSettings.bitrate);
      formData.append('sampleRate', audioSettings.sampleRate);
      formData.append('channels', audioSettings.channels);
      formData.append('volume', audioSettings.volume.toString());
      formData.append('fadeIn', audioSettings.fadeIn.toString());
      formData.append('fadeOut', audioSettings.fadeOut.toString());

      const response = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Export service failed');

      const mimeType = exportFormat === 'wav' ? 'audio/wav' : exportFormat === 'flac' ? 'audio/flac' : exportFormat === 'mp3' ? 'audio/mpeg' : 'video/mp4';
      const blob = await response.blob();

      const finalBlob = new Blob([blob], { type: mimeType });

      // Sanitize filename: remove special characters, keep only safe ones
      const safeBase = (audioState.fileName?.split('.')[0] || 'audio').replace(/[^a-z0-9_-]/gi, '_');
      const safeName = `${safeBase}_extract.${exportFormat}`;

      console.log('Final Download Blob:', { size: finalBlob.size, type: finalBlob.type, filename: safeName });

      if (finalBlob.size === 0) {
        throw new Error('Received empty blob from server');
      }

      const downloadUrl = URL.createObjectURL(finalBlob);

      const a = document.createElement('a');
      // Make it technically 'visible' but off-screen and 1x1 to appease browser security heuristics
      a.style.position = 'fixed';
      a.style.left = '-1000px';
      a.style.top = '-1000px';
      a.style.width = '1px';
      a.style.height = '1px';
      a.style.opacity = '0.01';
      a.href = downloadUrl;
      a.download = safeName;
      document.body.appendChild(a);

      // Standard click trigger with fallback
      try {
        a.click();
      } catch (err) {
        console.warn('Direct a.click() failed, trying dispatchEvent', err);
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }

      // Increased cleanup timeout to ensure slow downloads aren't interrupted 
      // although blob URLs are usually fine once the download start is triggered.
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
      }, 60000);

      setProcessing({ isProcessing: false, message: '', progress: 100 });
    } catch (error) {
      console.error('Export error:', error);
      setProcessing({ isProcessing: false, message: 'Export fehlgeschlagen.', progress: 0 });
      alert('Fehler beim Exportieren.');
    }
  };

  const handleManualTimeBlur = (type: 'start' | 'end') => {
    if (!audioState) return;
    let val = parseTimeString(type === 'start' ? manualStart : manualEnd);
    if (isNaN(val)) val = type === 'start' ? 0 : audioState.duration;

    if (type === 'start') {
      val = Math.max(0, Math.min(val, selection.end - 0.1));
      setSelection(p => ({ ...p, start: val }));
      if (currentTime < val) { setCurrentTime(val); startOffsetRef.current = val; }
    } else {
      val = Math.max(selection.start + 0.1, Math.min(val, audioState.duration));
      setSelection(p => ({ ...p, end: val }));
    }
  };

  const handleSeek = (time: number) => {
    const clamped = Math.max(selection.start, Math.min(selection.end, time));
    const wasPlaying = isPlaying;
    if (wasPlaying) stopPlayback();
    setCurrentTime(clamped);
    startOffsetRef.current = clamped;
    if (wasPlaying) requestAnimationFrame(() => startPlayback());
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans selection:bg-brand-500/30">

      {/* --- Navbar --- */}
      <header className="border-b border-white/5 bg-slate-950/50 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-gradient-to-br from-brand-400 to-brand-600 rounded-lg shadow-lg shadow-brand-500/20">
              <Music className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-slate-100">AudioEx</h1>
          </div>
          {audioState && (
            <button
              onClick={() => setAudioState(null)}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* --- Main Area --- */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-12 flex flex-col items-center justify-center">

        {!audioState ? (
          // Upload View
          <div className="w-full max-w-2xl animate-slide-up">
            <div className="relative group rounded-3xl border border-dashed border-slate-700 bg-slate-900/30 hover:bg-slate-900/50 hover:border-brand-500/50 transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

              {processing.isProcessing ? (
                <div className="p-10 md:p-20 flex flex-col items-center">
                  <div className="w-16 h-16 border-4 border-slate-700 border-t-brand-500 rounded-full animate-spin mb-6"></div>
                  <h3 className="text-xl font-medium text-white mb-2 text-center">{processing.message}</h3>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center p-10 md:p-20 cursor-pointer relative z-10">
                  <div className="mb-6 p-5 bg-slate-800 rounded-2xl group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-brand-500/20 transition-all duration-300">
                    <Upload className="w-10 h-10 text-brand-400" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-semibold text-white mb-3 text-center">Video hochladen</h2>
                  <p className="text-slate-400 text-center max-w-md mb-8 px-4 text-sm md:text-base">
                    MP4, MOV, WEBM. <br />
                    <span className="text-sm text-slate-500">Audioextraktion läuft sicher auf dem Server.</span>
                  </p>
                  <div className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-medium shadow-lg shadow-brand-500/25 transition-all">
                    Datei auswählen
                  </div>
                  <input type="file" accept="video/*,audio/*" onChange={handleFileUpload} className="hidden" />
                </label>
              )}
            </div>
          </div>
        ) : (
          // Editor View
          <div className="w-full animate-fade-in space-y-4 md:space-y-6">

            {/* File Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between px-2 gap-3">
              <div className="flex items-center gap-3 text-slate-300 min-w-0">
                <FileAudio className="w-5 h-5 text-brand-500 flex-shrink-0" />
                <span className="font-medium truncate">{audioState.fileName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm font-mono text-slate-500 bg-slate-900 px-3 py-1 rounded-full border border-slate-800 self-start sm:self-auto">
                <Clock className="w-3.5 h-3.5" />
                {formatTime(audioState.duration)}
              </div>
            </div>

            {/* Main Instrument Panel */}
            <div className="bg-slate-900/40 backdrop-blur-md rounded-2xl md:rounded-3xl border border-white/5 shadow-2xl overflow-hidden relative">
              {processing.isProcessing && <ProcessingOverlay message={processing.message} />}

              {/* Waveform Stage */}
              <div className="p-3 md:p-6 pb-2">
                <Waveform
                  audioBuffer={audioState.buffer!}
                  selection={selection}
                  currentTime={currentTime}
                  fadeIn={audioSettings.fadeIn}
                  fadeOut={audioSettings.fadeOut}
                  onSelectionChange={setSelection}
                  onSeek={handleSeek}
                />
              </div>

              {/* Control Bar */}
              <div className="px-4 py-4 md:px-6 md:py-6 bg-slate-950/30 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">

                {/* Transport */}
                <div className="flex items-center gap-6 w-full md:w-auto justify-center md:justify-start">
                  <button
                    onClick={isPlaying ? stopPlayback : startPlayback}
                    className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center transition-all duration-200 shadow-xl ${isPlaying ? 'bg-slate-800 text-red-400 hover:bg-slate-700' : 'bg-brand-500 text-white hover:bg-brand-400 hover:scale-105 shadow-brand-500/20'}`}
                  >
                    {isPlaying ? <Pause className="w-5 h-5 md:w-6 md:h-6 fill-current" /> : <Play className="w-5 h-5 md:w-6 md:h-6 fill-current ml-1" />}
                  </button>

                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500 mb-0.5">Aktuelle Zeit</div>
                    <div className="font-mono text-xl md:text-2xl text-white tracking-tight">
                      {formatTime(currentTime)}
                    </div>
                  </div>
                </div>

                {/* Precision Inputs */}
                <div className="flex items-center gap-2 md:gap-4 bg-slate-950/50 p-2 rounded-xl border border-white/5 w-full md:w-auto justify-center">
                  <TimeInput
                    label="Start"
                    value={manualStart}
                    onChange={setManualStart}
                    onBlur={() => handleManualTimeBlur('start')}
                  />
                  <div className="h-8 w-px bg-slate-700 mt-4" />
                  <TimeInput
                    label="Ende"
                    value={manualEnd}
                    onChange={setManualEnd}
                    onBlur={() => handleManualTimeBlur('end')}
                  />
                  <button
                    onClick={() => { setSelection({ start: 0, end: audioState.duration }); setCurrentTime(0); }}
                    className="mt-5 p-2 text-slate-500 hover:text-brand-400 hover:bg-white/5 rounded-lg transition-colors"
                    title="Auswahl zurücksetzen"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

              </div>
            </div>

            {/* Main Export & Settings Controls */}
            <div className="space-y-8 mt-4">

              {/* Top Row: Format Selection & Export Button */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex flex-wrap items-center justify-center md:items-stretch gap-2 bg-slate-900/40 p-1.5 rounded-2xl border border-white/5 backdrop-blur-sm">
                  <button
                    onClick={() => setExportFormat('wav')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-300 ${exportFormat === 'wav' ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                  >
                    <MusicIcon className="w-4 h-4" />
                    <span className="font-semibold text-sm">WAV</span>
                  </button>
                  <button
                    onClick={() => setExportFormat('flac')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-300 ${exportFormat === 'flac' ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                  >
                    <MusicIcon className="w-4 h-4" />
                    <span className="font-semibold text-sm">FLAC</span>
                  </button>
                  <button
                    onClick={() => setExportFormat('mp3')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-300 ${exportFormat === 'mp3' ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                  >
                    <MusicIcon className="w-4 h-4" />
                    <span className="font-semibold text-sm">MP3</span>
                  </button>
                  <button
                    onClick={() => setExportFormat('mp4')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-300 ${exportFormat === 'mp4' ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                  >
                    <Video className="w-4 h-4" />
                    <span className="font-semibold text-sm">Video</span>
                  </button>
                </div>

                <Button
                  onClick={handleDownload}
                  className="w-full md:w-auto !bg-gradient-to-r !from-brand-600 !to-brand-500 !text-white !px-12 !py-5 !rounded-2xl !text-xl !font-bold !shadow-2xl !shadow-brand-500/30 hover:!shadow-brand-500/50 hover:!scale-[1.03] active:!scale-[0.98] transition-all duration-300 group"
                  icon={<Download className="w-6 h-6 mr-2 group-hover:animate-bounce" />}
                >
                  {exportFormat === 'mp4' ? 'Video exportieren' : 'Audio exportieren'}
                </Button>
              </div>

              {/* Bottom Section: Collapsible Settings */}
              <div className="flex flex-col gap-5 pt-2">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="flex items-center gap-2 text-slate-400 hover:text-brand-400 self-center md:self-start px-2 py-1.5 transition-all group"
                >
                  <div className={`p-1.5 rounded-lg border border-white/5 bg-slate-900 group-hover:border-brand-500/30 transition-all ${showSettings ? 'text-brand-400' : ''}`}>
                    <Settings className={`w-4 h-4 transition-transform duration-500 ${showSettings ? 'rotate-180' : ''}`} />
                  </div>
                  <span className="text-sm font-semibold tracking-wide">Erweiterte Audio-Einstellungen</span>
                  {showSettings ? <ChevronUp className="w-4 h-4 opacity-50" /> : <ChevronDown className="w-4 h-4 opacity-50" />}
                </button>

                {showSettings && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 p-8 bg-slate-900/30 backdrop-blur-md rounded-[2.5rem] border border-white/5 shadow-2xl animate-in fade-in slide-in-from-top-6 duration-700 ease-out">
                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">Bitrate</label>
                      <select
                        value={audioSettings.bitrate}
                        onChange={(e) => setAudioSettings(s => ({ ...s, bitrate: e.target.value }))}
                        className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                      >
                        <option value="128k">128 kbps (Standard)</option>
                        <option value="192k">192 kbps (Medium)</option>
                        <option value="256k">256 kbps (High)</option>
                        <option value="320k">320 kbps (Extreme)</option>
                      </select>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">Sample Rate</label>
                      <select
                        value={audioSettings.sampleRate}
                        onChange={(e) => setAudioSettings(s => ({ ...s, sampleRate: e.target.value }))}
                        className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                      >
                        <option value="44100">44.1 kHz (CD)</option>
                        <option value="48000">48 kHz (Pro)</option>
                      </select>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">Kanäle</label>
                      <select
                        value={audioSettings.channels}
                        onChange={(e) => setAudioSettings(s => ({ ...s, channels: e.target.value }))}
                        className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                      >
                        <option value="1">Mono (Single)</option>
                        <option value="2">Stereo (Dual)</option>
                      </select>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em] flex justify-between mr-1">
                        <span>Lautstärke</span>
                        <span className="text-brand-400 font-mono text-xs">{Math.round(audioSettings.volume * 100)}%</span>
                      </label>
                      <div className="pt-3 px-1">
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={audioSettings.volume}
                          onChange={(e) => setAudioSettings(s => ({ ...s, volume: parseFloat(e.target.value) }))}
                          className="w-full accent-brand-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer hover:accent-brand-400 transition-all shadow-inner"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em] flex justify-between mr-1">
                        <span>Fade In</span>
                        <span className="text-brand-400 font-mono text-xs">{audioSettings.fadeIn}s</span>
                      </label>
                      <div className="pt-3 px-1">
                        <input
                          type="range"
                          min="0"
                          max="10"
                          step="0.5"
                          value={audioSettings.fadeIn}
                          onChange={(e) => setAudioSettings(s => ({ ...s, fadeIn: parseFloat(e.target.value) }))}
                          className="w-full accent-brand-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer hover:accent-brand-400 transition-all shadow-inner"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em] flex justify-between mr-1">
                        <span>Fade Out</span>
                        <span className="text-brand-400 font-mono text-xs">{audioSettings.fadeOut}s</span>
                      </label>
                      <div className="pt-3 px-1">
                        <input
                          type="range"
                          min="0"
                          max="10"
                          step="0.5"
                          value={audioSettings.fadeOut}
                          onChange={(e) => setAudioSettings(s => ({ ...s, fadeOut: parseFloat(e.target.value) }))}
                          className="w-full accent-brand-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer hover:accent-brand-400 transition-all shadow-inner"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

      </main>

      <footer className="py-8 text-center text-slate-600 text-xs">
        <p>Secure Processing • AudioEx v2.0</p>
      </footer>
    </div>
  );
}
