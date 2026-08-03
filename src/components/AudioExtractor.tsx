"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Play, Pause, Download, Music, X, RotateCcw, FileAudio, Clock, Video, Music as MusicIcon, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { AudioState, ProcessingState, SelectionRange, ExportFormat, AudioSettings, VideoSettings } from '@/types';
import { formatTime, parseTimeString } from '@/utils/audioHelper';
import { runWavWorker } from '@/utils/wav-worker';
import { translations, Language } from '@/utils/i18n';
import Waveform from '@/components/Waveform';
import Button from '@/components/Button';
import TimeInput from '@/components/TimeInput';
import ProcessingOverlay from '@/components/ProcessingOverlay';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { useUser, UserButton } from '@clerk/nextjs';
import { buildAudioFilters } from '@/utils/ffmpegHelpers';

const FFMPEG_LOAD_TIMEOUT_MS = 30000;





export default function AudioExtractor() {
  const { isSignedIn } = useUser();
  // State
  const [language, setLanguage] = useState<Language>('de');
  const t = translations[language];
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
  const [videoSettings, setVideoSettings] = useState<VideoSettings>({
    fps: 'original',
    resolution: 'original',
    quality: 'original'
  });
  const [showSettings, setShowSettings] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(false);

  // Cleanup object URL helper
  const cleanupVideoUrl = useCallback(() => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
  }, [videoUrl]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  // Init AudioContext
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioContextRef.current = new AudioContextClass();
    }
    return () => { audioContextRef.current?.close(); };
  }, []);

  // Sync manual inputs
  useEffect(() => {
    setManualStart(formatTime(selection.start));
    setManualEnd(formatTime(selection.end));
  }, [selection]);

  // Sync video play state with isPlaying
  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.play().catch(e => console.warn("Video play failed:", e));
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      const source = sourceNodeRef.current;
      sourceNodeRef.current = null; // Clear reference first to prevent recursive onended
      try { source.stop(); } catch {}
      source.disconnect();
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
    }
    if (audioContextRef.current) {
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      const newTime = Math.min(selection.end, Math.max(selection.start, startOffsetRef.current + elapsed));
      setCurrentTime(newTime);
      startOffsetRef.current = newTime;
      if (videoRef.current) {
        videoRef.current.currentTime = newTime;
      }
    }
  }, [selection]);

  // Playback Loop
  const updateProgress = useCallback(() => {
    if (!isPlayingRef.current || !audioContextRef.current) return;
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
  }, [selection, stopPlayback]);

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(updateProgress);
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [isPlaying, updateProgress]);

  // Handlers
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopPlayback();
    cleanupVideoUrl();
    setAudioState(null);
    setProcessing({ isProcessing: true, message: t.analyzing, progress: 10 });

    try {
      if (file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
      }
      const arrayBuffer = await file.arrayBuffer();
      setProcessing({ isProcessing: true, message: t.extracting, progress: 40 });

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
      cleanupVideoUrl();
      setProcessing({ isProcessing: false, message: t.loadingError, progress: 0 });
      alert(t.processingError);
    }
  };

  const startPlayback = useCallback(() => {
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
    const playDuration = selection.end - startPos;
    if (playDuration <= 0) return;

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

    // Schedule stop and setup ended event handler
    source.start(0, startPos, playDuration);
    if (videoRef.current) {
      videoRef.current.currentTime = startPos;
      videoRef.current.play().catch(e => console.warn("Video play failed:", e));
    }
    source.onended = () => {
      if (sourceNodeRef.current === source) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        sourceNodeRef.current = null;
        setCurrentTime(selection.start);
        startOffsetRef.current = selection.start;
        if (videoRef.current) {
          try { videoRef.current.pause(); } catch {}
          videoRef.current.currentTime = selection.start;
        }
      }
    };

    startTimeRef.current = audioContextRef.current.currentTime;
    startOffsetRef.current = startPos;
    sourceNodeRef.current = source;
    setIsPlaying(true);
    isPlayingRef.current = true;
  }, [audioState, currentTime, selection, audioSettings, setIsPlaying]);

  // Spacebar toggle play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const activeEl = document.activeElement;
        const isInput = activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable
        );
        if (isInput) return;

        e.preventDefault(); // Prevent page scroll
        if (audioState) {
          if (isPlaying) {
            stopPlayback();
          } else {
            startPlayback();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPlaying, audioState, startPlayback, stopPlayback]);



  const ffmpegRef = useRef<FFmpeg | null>(null);

  const initFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setProcessing({ isProcessing: true, message: language === 'de' ? 'Lade FFmpeg (Client)...' : 'Loading FFmpeg (Client)...', progress: 5 });
    try {
      const ffmpeg = new FFmpeg();

      ffmpeg.on('log', ({ message }) => {
        console.log('FFmpeg.wasm:', message);
      });

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      const withTimeout = <T,>(promise: Promise<T>, label: string): Promise<T> =>
        Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out loading ${label}`)), FFMPEG_LOAD_TIMEOUT_MS)
          ),
        ]);

      await withTimeout(
        ffmpeg.load({
          coreURL: await withTimeout(toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'), 'ffmpeg-core.js'),
          wasmURL: await withTimeout(toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'), 'ffmpeg-core.wasm'),
        }),
        'ffmpeg.wasm'
      );

      ffmpegRef.current = ffmpeg;
      return ffmpeg;
    } catch (error) {
      console.error('Failed to load FFmpeg.wasm:', error);
      throw error;
    }
  };

  const handleDownload = async () => {
    if (!audioState || !audioContextRef.current) return;

    const safeBase = (audioState.fileName?.split('.')[0] || 'audio').replace(/[^a-z0-9_-]/gi, '_');
    const safeName = `${safeBase}_extract.${exportFormat}`;

    setProcessing({ isProcessing: true, message: `${t.exporting} ${exportFormat.toUpperCase()}...`, progress: 10 });

    try {
      let finalBlob: Blob;

      if (exportFormat === 'wav') {
        // Client-side Offline Audio Context Rendering for WAV
        const channelsNum = parseInt(audioSettings.channels);
        const sampleRateNum = parseInt(audioSettings.sampleRate);
        const durationSec = selection.end - selection.start;

        if (durationSec <= 0) {
          throw new Error('Selection duration must be greater than 0');
        }

        const offlineCtx = new OfflineAudioContext(
          channelsNum,
          Math.floor(sampleRateNum * durationSec),
          sampleRateNum
        );

        // Source buffer node
        const source = offlineCtx.createBufferSource();
        source.buffer = audioState.buffer;

        // Gain node for volume and fades
        const gainNode = offlineCtx.createGain();

        // Apply volume
        gainNode.gain.setValueAtTime(audioSettings.volume, 0);

        // Apply fade in
        if (audioSettings.fadeIn > 0) {
          gainNode.gain.setValueAtTime(0, 0);
          gainNode.gain.linearRampToValueAtTime(audioSettings.volume, audioSettings.fadeIn);
        }

        // Apply fade out
        if (audioSettings.fadeOut > 0) {
          const fadeOutStart = Math.max(0, durationSec - audioSettings.fadeOut);
          gainNode.gain.setValueAtTime(audioSettings.volume, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0, durationSec);
        }

        source.connect(gainNode);
        gainNode.connect(offlineCtx.destination);

        // Start reading from the selection start and play for the selection duration
        source.start(0, selection.start, durationSec);

        setProcessing({ isProcessing: true, message: `${t.exporting} ${exportFormat.toUpperCase()} (Client)...`, progress: 50 });
        const renderedBuffer = await offlineCtx.startRendering();

        setProcessing({ isProcessing: true, message: `${t.exporting} ${exportFormat.toUpperCase()} (Worker)...`, progress: 80 });
        const channelData: Float32Array[] = [];
        for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
          channelData.push(renderedBuffer.getChannelData(ch));
        }
        finalBlob = await runWavWorker(channelData, renderedBuffer.sampleRate);
      } else {
        const isVideo = audioState.file.type.startsWith('video/');

        if (exportFormat === 'mp4' && isVideo) {
          // Process video using client-side FFmpeg.wasm
          setProcessing({ isProcessing: true, message: `${t.exporting} - Loading video transcoder...`, progress: 20 });
          const ffmpeg = await initFFmpeg();

          const inputExt = audioState.file.name.split('.').pop() || 'mp4';
          const inputFilename = `input.${inputExt}`;
          const outputFilename = 'output.mp4';

          setProcessing({ isProcessing: true, message: `${t.exporting} - Writing video buffer...`, progress: 40 });
          await ffmpeg.writeFile(inputFilename, await fetchFile(audioState.file));

          const durationSec = selection.end - selection.start;
          const needsVideoReencode =
            videoSettings.fps !== 'original' ||
            videoSettings.resolution !== 'original' ||
            videoSettings.quality !== 'original';

          const videoCodecArgs: string[] = [];
          if (needsVideoReencode) {
            videoCodecArgs.push('-c:v', 'libx264', '-preset', 'ultrafast');

            // Apply Framerate (FPS)
            if (videoSettings.fps !== 'original') {
              videoCodecArgs.push('-r', videoSettings.fps);
            }

            // Apply Resolution (scale filter)
            if (videoSettings.resolution !== 'original') {
              const [width] = videoSettings.resolution.split('x');
              videoCodecArgs.push('-vf', `scale=${width}:-2`);
            }

            // Apply Quality (CRF)
            if (videoSettings.quality !== 'original') {
              const crfVal = videoSettings.quality === 'high' ? '18' : videoSettings.quality === 'low' ? '28' : '23';
              videoCodecArgs.push('-crf', crfVal);
            }
          } else {
            videoCodecArgs.push('-c:v', 'copy');
          }

          const cmdArgs = [
            '-ss', selection.start.toString(),
            '-t', durationSec.toString(),
            '-i', inputFilename,
            ...videoCodecArgs,
            '-c:a', 'aac',
            '-b:a', audioSettings.bitrate,
            '-ar', audioSettings.sampleRate,
            '-ac', audioSettings.channels
          ];

          // Audio filters for volume/fades (shared with server-side export)
          const filters = buildAudioFilters(audioSettings.volume, audioSettings.fadeIn, audioSettings.fadeOut, durationSec);

          if (filters.length > 0) {
            cmdArgs.push('-af', filters.join(','));
          }

          cmdArgs.push(outputFilename);

          setProcessing({ isProcessing: true, message: `${t.exporting} - Running transcoder (Client)...`, progress: 60 });
          await ffmpeg.exec(cmdArgs);

          setProcessing({ isProcessing: true, message: `${t.exporting} - Reading output...`, progress: 90 });
          const fileData = await ffmpeg.readFile(outputFilename);
          finalBlob = new Blob([fileData as unknown as BlobPart], { type: 'video/mp4' });

          // Cleanup virtual files
          await ffmpeg.deleteFile(inputFilename);
          await ffmpeg.deleteFile(outputFilename);
        } else {
          // Render selection client-side to WAV first, then transcode using FFmpeg.wasm client-side
          const channelsNum = parseInt(audioSettings.channels);
          const sampleRateNum = parseInt(audioSettings.sampleRate);
          const durationSec = selection.end - selection.start;

          if (durationSec <= 0) {
            throw new Error('Selection duration must be greater than 0');
          }

          setProcessing({ isProcessing: true, message: `${t.exporting} - Slicing Audio (Client)...`, progress: 20 });

          const offlineCtx = new OfflineAudioContext(
            channelsNum,
            Math.floor(sampleRateNum * durationSec),
            sampleRateNum
          );

          const source = offlineCtx.createBufferSource();
          source.buffer = audioState.buffer;

          const gainNode = offlineCtx.createGain();
          gainNode.gain.setValueAtTime(audioSettings.volume, 0);

          if (audioSettings.fadeIn > 0) {
            gainNode.gain.setValueAtTime(0, 0);
            gainNode.gain.linearRampToValueAtTime(audioSettings.volume, audioSettings.fadeIn);
          }

          if (audioSettings.fadeOut > 0) {
            const fadeOutStart = Math.max(0, durationSec - audioSettings.fadeOut);
            gainNode.gain.setValueAtTime(audioSettings.volume, fadeOutStart);
            gainNode.gain.linearRampToValueAtTime(0, durationSec);
          }

          source.connect(gainNode);
          gainNode.connect(offlineCtx.destination);
          source.start(0, selection.start, durationSec);

          const renderedBuffer = await offlineCtx.startRendering();

          setProcessing({ isProcessing: true, message: `${t.exporting} - Preparing audio stream (Client)...`, progress: 40 });

          const channelData: Float32Array[] = [];
          for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
            channelData.push(renderedBuffer.getChannelData(ch));
          }

          const audioOnlyWavBlob = await runWavWorker(channelData, renderedBuffer.sampleRate);

          setProcessing({ isProcessing: true, message: `${t.exporting} - Initializing transcoder (Client)...`, progress: 60 });
          const ffmpeg = await initFFmpeg();

          const inputFilename = 'input.wav';
          const outputFilename = `output.${exportFormat}`;

          await ffmpeg.writeFile(inputFilename, await fetchFile(audioOnlyWavBlob));

          const cmdArgs = ['-i', inputFilename];
          if (exportFormat === 'mp3') {
            cmdArgs.push('-acodec', 'libmp3lame', '-b:a', audioSettings.bitrate);
          } else if (exportFormat === 'flac') {
            cmdArgs.push('-acodec', 'flac');
          }
          cmdArgs.push('-ar', audioSettings.sampleRate, '-ac', audioSettings.channels, outputFilename);

          setProcessing({ isProcessing: true, message: `${t.exporting} - Transcoding to ${exportFormat.toUpperCase()} (Client)...`, progress: 80 });
          await ffmpeg.exec(cmdArgs);

          const fileData = await ffmpeg.readFile(outputFilename);
          const mimeType = exportFormat === 'flac' ? 'audio/flac' : 'audio/mpeg';
          finalBlob = new Blob([fileData as unknown as BlobPart], { type: mimeType });

          // Cleanup virtual files
          await ffmpeg.deleteFile(inputFilename);
          await ffmpeg.deleteFile(outputFilename);
        }
      }

      console.log('Final Download Blob:', { size: finalBlob.size, type: finalBlob.type, filename: safeName });

      if (finalBlob.size === 0) {
        throw new Error('Received empty blob from export');
      }

      const downloadUrl = URL.createObjectURL(finalBlob);

      const a = document.createElement('a');
      a.style.position = 'fixed';
      a.style.left = '-1000px';
      a.style.top = '-1000px';
      a.style.width = '1px';
      a.style.height = '1px';
      a.style.opacity = '0.01';
      a.href = downloadUrl;
      a.download = safeName;
      document.body.appendChild(a);

      try {
        a.click();
      } catch (err) {
        console.warn('Direct a.click() failed, trying dispatchEvent', err);
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }

      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
      }, 60000);

      setProcessing({ isProcessing: false, message: '', progress: 100 });
    } catch (error) {
      console.error('Export error:', error);
      setProcessing({ isProcessing: false, message: t.exportFailed, progress: 0 });
      alert(t.exportError);
    }
  };

  const handleManualTimeBlur = (type: 'start' | 'end') => {
    if (!audioState) return;
    let val = parseTimeString(type === 'start' ? manualStart : manualEnd);
    if (isNaN(val)) val = type === 'start' ? 0 : audioState.duration;

    if (type === 'start') {
      val = Math.max(0, Math.min(val, selection.end - 0.1));
      setSelection(p => ({ ...p, start: val }));
      if (currentTime < val) { 
        setCurrentTime(val); 
        startOffsetRef.current = val; 
        if (videoRef.current) {
          videoRef.current.currentTime = val;
        }
      }
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
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
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
            <h1 className="text-lg font-bold tracking-tight text-slate-100">{t.title}</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setLanguage('de')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${language === 'de' ? 'bg-brand-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                DE
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${language === 'en' ? 'bg-brand-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                EN
              </button>
            </div>

            {isSignedIn && (
              <div className="flex items-center">
                <UserButton />
              </div>
            )}

            {audioState && (
              <button
                onClick={() => { setAudioState(null); cleanupVideoUrl(); }}
                aria-label={t.closeFile}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
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
                  <h2 className="text-xl md:text-2xl font-semibold text-white mb-3 text-center">{t.uploadTitle}</h2>
                  <p className="text-slate-400 text-center max-w-md mb-8 px-4 text-sm md:text-base">
                    {t.uploadSubtitle} <br />
                    <span className="text-sm text-slate-500">{t.uploadSecondarySubtitle}</span>
                  </p>
                  <div className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-medium shadow-lg shadow-brand-500/25 transition-all">
                    {t.selectFile}
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

              {/* Video Preview */}
              {videoUrl && (
                <div className="flex justify-center bg-slate-950/40 border-b border-white/5 p-4">
                  <div className="relative w-full max-w-lg aspect-video rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      className="w-full h-full object-contain cursor-pointer"
                      playsInline
                      muted
                      onClick={isPlaying ? stopPlayback : startPlayback}
                    />
                  </div>
                </div>
              )}

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
                    <div className="text-[10px] uppercase font-bold text-slate-500 mb-0.5">{t.currentTime}</div>
                    <div className="font-mono text-xl md:text-2xl text-white tracking-tight">
                      {formatTime(currentTime)}
                    </div>
                  </div>
                </div>

                {/* Precision Inputs */}
                <div className="flex items-center gap-2 md:gap-4 bg-slate-950/50 p-2 rounded-xl border border-white/5 w-full md:w-auto justify-center">
                  <TimeInput
                    label={t.start}
                    value={manualStart}
                    onChange={setManualStart}
                    onBlur={() => handleManualTimeBlur('start')}
                  />
                  <div className="h-8 w-px bg-slate-700 mt-4" />
                  <TimeInput
                    label={t.end}
                    value={manualEnd}
                    onChange={setManualEnd}
                    onBlur={() => handleManualTimeBlur('end')}
                  />
                  <button
                    onClick={() => { setSelection({ start: 0, end: audioState.duration }); setCurrentTime(0); }}
                    className="mt-5 p-2 text-slate-500 hover:text-brand-400 hover:bg-white/5 rounded-lg transition-colors"
                    title={t.resetSelection}
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
                  className="w-full md:w-auto bg-gradient-to-r from-brand-600 to-brand-500 text-white px-12 py-5 rounded-2xl text-xl font-bold shadow-2xl shadow-brand-500/30 hover:shadow-brand-500/50 hover:scale-[1.03] active:scale-[0.98] transition-all duration-300 group"
                  icon={<Download className="w-6 h-6 mr-2 group-hover:animate-bounce" />}
                >
                  {exportFormat === 'mp4' ? t.exportVideo : t.exportAudio}
                </Button>
              </div>

              {/* Bottom Section: Collapsible Settings */}
              <div className="flex flex-col gap-5 pt-2">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  aria-label={t.toggleSettings}
                  aria-expanded={showSettings}
                  className="flex items-center gap-2 text-slate-400 hover:text-brand-400 self-center md:self-start px-2 py-1.5 transition-all group"
                >
                  <div className={`p-1.5 rounded-lg border border-white/5 bg-slate-900 group-hover:border-brand-500/30 transition-all ${showSettings ? 'text-brand-400' : ''}`}>
                    <Settings className={`w-4 h-4 transition-transform duration-500 ${showSettings ? 'rotate-180' : ''}`} />
                  </div>
                  <span className="text-sm font-semibold tracking-wide">{t.advancedSettings}</span>
                  {showSettings ? <ChevronUp className="w-4 h-4 opacity-50" /> : <ChevronDown className="w-4 h-4 opacity-50" />}
                </button>

                {showSettings && (
                  <div className="space-y-8 p-8 bg-slate-900/30 backdrop-blur-md rounded-[2.5rem] border border-white/5 shadow-2xl animate-in fade-in slide-in-from-top-6 duration-700 ease-out">
                    
                    {/* Audio Settings Section */}
                    <div className="space-y-4">
                      <h3 className="text-xs uppercase font-extrabold tracking-wider text-brand-400 border-b border-white/5 pb-2">
                        {t.audioSettings}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {['mp3', 'mp4'].includes(exportFormat) && (
                          <div className="space-y-3">
                            <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">{t.bitrate}</label>
                            <select
                              value={audioSettings.bitrate}
                              onChange={(e) => setAudioSettings(s => ({ ...s, bitrate: e.target.value }))}
                              className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                            >
                              <option value="128k">128 kbps ({t.standard})</option>
                              <option value="192k">192 kbps ({t.medium})</option>
                              <option value="256k">256 kbps ({t.high})</option>
                              <option value="320k">320 kbps ({t.extreme})</option>
                            </select>
                          </div>
                        )}

                        <div className="space-y-3">
                          <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">{t.sampleRate}</label>
                          <select
                            value={audioSettings.sampleRate}
                            onChange={(e) => setAudioSettings(s => ({ ...s, sampleRate: e.target.value }))}
                            className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                          >
                            <option value="24000">24 kHz</option>
                            <option value="44100">44.1 kHz (CD)</option>
                            <option value="48000">48 kHz (Pro)</option>
                          </select>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">{t.channels}</label>
                          <select
                            value={audioSettings.channels}
                            onChange={(e) => setAudioSettings(s => ({ ...s, channels: e.target.value }))}
                            className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                          >
                            <option value="1">{t.mono}</option>
                            <option value="2">{t.stereo}</option>
                          </select>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em] flex justify-between mr-1">
                            <span>{t.volume}</span>
                            <span className="text-brand-400 font-mono text-xs">{Math.round(audioSettings.volume * 100)}%</span>
                          </label>
                          <div className="pt-2 px-1">
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

                        <div className="space-y-3">
                          <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em] flex justify-between mr-1">
                            <span>{t.fadeIn}</span>
                            <span className="text-brand-400 font-mono text-xs">{audioSettings.fadeIn}s</span>
                          </label>
                          <div className="pt-2 px-1">
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

                        <div className="space-y-3">
                          <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em] flex justify-between mr-1">
                            <span>{t.fadeOut}</span>
                            <span className="text-brand-400 font-mono text-xs">{audioSettings.fadeOut}s</span>
                          </label>
                          <div className="pt-2 px-1">
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
                    </div>

                    {/* Video Settings Section */}
                    {exportFormat === 'mp4' && (
                      <div className="space-y-4 pt-4 border-t border-white/5">
                        <h3 className="text-xs uppercase font-extrabold tracking-wider text-brand-400 border-b border-white/5 pb-2">
                          {t.videoSettings}
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                          <div className="space-y-3">
                            <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">{t.frameRate}</label>
                            <select
                              value={videoSettings.fps}
                              onChange={(e) => setVideoSettings(s => ({ ...s, fps: e.target.value }))}
                              className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                            >
                              <option value="original">{t.original}</option>
                              <option value="60">60 FPS</option>
                              <option value="50">50 FPS</option>
                              <option value="30">30 FPS</option>
                              <option value="25">25 FPS</option>
                              <option value="24">24 FPS</option>
                              <option value="15">15 FPS</option>
                            </select>
                          </div>

                          <div className="space-y-3">
                            <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">{t.resolution}</label>
                            <select
                              value={videoSettings.resolution}
                              onChange={(e) => setVideoSettings(s => ({ ...s, resolution: e.target.value }))}
                              className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                            >
                              <option value="original">{t.original}</option>
                              <option value="1920x1080">1080p (Full HD)</option>
                              <option value="1280x720">720p (HD)</option>
                              <option value="854x480">480p (SD)</option>
                              <option value="640x360">360p</option>
                            </select>
                          </div>

                          <div className="space-y-3">
                            <label className="text-[10px] uppercase font-black text-slate-500 ml-1 tracking-[0.2em]">{t.quality}</label>
                            <select
                              value={videoSettings.quality}
                              onChange={(e) => setVideoSettings(s => ({ ...s, quality: e.target.value }))}
                              className="w-full bg-slate-950/80 border border-white/5 text-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all cursor-pointer appearance-none shadow-inner"
                            >
                              <option value="original">{t.auto}</option>
                              <option value="high">{t.highQuality}</option>
                              <option value="medium">{t.mediumQuality}</option>
                              <option value="low">{t.lowQuality}</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                    
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

      </main>

      <footer className="py-8 text-center text-slate-600 text-xs">
        <p>{t.footer}</p>
      </footer>
    </div>
  );
}
