import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { isAllowedExportFormat, buildAudioFilters, MIME_TYPE_BY_FORMAT } from '@/utils/ffmpegHelpers';

import { existsSync } from 'fs';

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
const ALLOWED_MIME_PREFIXES = ['audio/', 'video/'];

// Set ffmpeg path
let ffmpegPath: string;
try {
    // Dynamic resolution from ffmpeg-static
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath || !existsSync(ffmpegPath)) {
        console.error('ffmpeg-static resolution failed to find binary at:', ffmpegPath);
        throw new Error('ffmpeg-static did not provide a valid path');
    }
} catch (e: unknown) {
    const err = e as Error;
    console.warn('ffmpeg-static resolution ERROR:', err?.message || err);
    ffmpegPath = 'ffmpeg'; // Default to system PATH
}

console.log('Resolved FFmpeg path:', ffmpegPath);
ffmpeg.setFfmpegPath(ffmpegPath);

export async function POST(req: NextRequest) {
    const id = uuidv4();
    // Unique per-request subdirectory so concurrent requests never collide
    // and a single rm(tempDir, { recursive: true }) cleans everything up.
    const tempDir = join(tmpdir(), 'audio-extractor', id);
    await mkdir(tempDir, { recursive: true });

    let inputPath = '';
    let outputPath = '';

    try {
        const formData = await req.formData();
        const file = formData.get('file');
        const start = parseFloat(formData.get('start') as string);
        const duration = parseFloat(formData.get('duration') as string);
        const format = formData.get('format');

        // Audio Settings
        const bitrate = formData.get('bitrate') as string || '192k';
        const sampleRate = formData.get('sampleRate') as string || '44100';
        const channels = formData.get('channels') as string || '2';
        const volume = parseFloat(formData.get('volume') as string || '1');
        const fadeIn = parseFloat(formData.get('fadeIn') as string || '0');
        const fadeOut = parseFloat(formData.get('fadeOut') as string || '0');
        const fps = formData.get('fps') as string || 'original';

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        if (!isAllowedExportFormat(format)) {
            return NextResponse.json({ error: 'Invalid or unsupported format' }, { status: 400 });
        }

        if (!Number.isFinite(start) || start < 0) {
            return NextResponse.json({ error: 'Invalid start time' }, { status: 400 });
        }

        if (!Number.isFinite(duration) || duration <= 0) {
            return NextResponse.json({ error: 'Invalid duration' }, { status: 400 });
        }

        if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
            return NextResponse.json({ error: 'File size out of allowed range' }, { status: 400 });
        }

        if (!ALLOWED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))) {
            return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
        }

        const fileExt = file.name.split('.').pop() || 'tmp';
        inputPath = join(tempDir, `input.${fileExt}`);
        outputPath = join(tempDir, `output.${format}`);

        const bytes = await file.arrayBuffer();
        await writeFile(inputPath, Buffer.from(bytes));

        // Pre-flight check for ffmpeg binary
        // Only check existence if it's an absolute path.
        // If it's just 'ffmpeg', assume it's on the PATH and fluent-ffmpeg will find it.
        const isActuallyAPath = ffmpegPath.includes('/') || ffmpegPath.includes('\\');
        if (isActuallyAPath && !existsSync(ffmpegPath)) {
            console.error('FFmpeg binary not found at path:', ffmpegPath);
            throw new Error(`FFmpeg binary not found at expected location: ${ffmpegPath}`);
        }

        // Process to file
        await new Promise((resolve, reject) => {
            let command = ffmpeg(inputPath)
                .setStartTime(start)
                .setDuration(duration);

            // Set global options
            command = command.outputOptions('-y'); // Overwrite output files

            if (format === 'wav') {
                command = command
                    .noVideo()
                    .audioCodec('pcm_s16le')
                    .format('wav');
            } else if (format === 'flac') {
                command = command
                    .noVideo()
                    .audioCodec('flac')
                    .format('flac');
            } else if (format === 'mp3') {
                command = command
                    .noVideo()
                    .audioCodec('libmp3lame')
                    .audioBitrate(bitrate)
                    .format('mp3');
            } else {
                if (file.name !== 'audio.wav') {
                    if (fps && fps !== 'original') {
                        command = command
                            .videoCodec('libx264')
                            .outputOptions([
                                '-preset ultrafast',
                                `-r ${fps}`
                            ]);
                    } else {
                        command = command.videoCodec('copy');
                    }
                } else {
                    command = command.noVideo();
                }
                command = command
                    .audioCodec('aac')
                    .audioBitrate(bitrate)
                    .format('mp4')
                    .outputOptions([
                        '-movflags +faststart'
                    ]);
            }

            // Apply shared audio properties
            command = command
                .audioChannels(parseInt(channels))
                .audioFrequency(parseInt(sampleRate));

            // Audio Filters (shared with client-side ffmpeg.wasm export)
            const filters = buildAudioFilters(volume, fadeIn, fadeOut, duration);

            if (filters.length > 0) {
                command = command.audioFilters(filters);
            }

            command
                .on('start', (commandLine) => {
                    console.log('Spawned FFmpeg with command: ' + commandLine);
                })
                .on('stderr', (stderrLine) => {
                    // Log FFmpeg stderr for deeper debugging
                    if (stderrLine.includes('Error') || stderrLine.includes('error')) {
                        console.error('FFmpeg stderr:', stderrLine);
                    }
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('FFmpeg error:', err.message);
                    console.error('FFmpeg stderr:', stderr);
                    reject(new Error(`FFmpeg failed: ${err.message}. ${stderr}`));
                })
                .on('end', () => {
                    console.log('FFmpeg processing finished');
                    resolve(true);
                })
                .save(outputPath);
        });

        // Read resulting file
        const finalBuffer = await readFile(outputPath);
        const fileSize = finalBuffer.length;

        // Cleanup temporary files
        await rm(tempDir, { recursive: true, force: true }).catch((e) => console.error('Cleanup warning:', e));

        const mimeType = MIME_TYPE_BY_FORMAT[format];

        // Return robust response
        const safeFilename = `extract.${format}`;
        const encodedFilename = encodeURIComponent(safeFilename);

        return new Response(new Uint8Array(finalBuffer), {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
                'Content-Length': fileSize.toString(),
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
            },
        });

    } catch (error: unknown) {
        const err = error as Error;
        console.error('API Error:', err);

        // Final cleanup attempt
        await rm(tempDir, { recursive: true, force: true }).catch((e) => console.error('Final cleanup warning:', e));

        return NextResponse.json({
            error: 'Processing failed',
            details: err.message || String(err)
        }, { status: 500 });
    }
}
