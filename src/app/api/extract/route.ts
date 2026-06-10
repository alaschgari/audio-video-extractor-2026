import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

import { existsSync } from 'fs';

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
    const tempDir = join(tmpdir(), 'audio-extractor');
    await mkdir(tempDir, { recursive: true });

    let inputPath = '';
    let outputPath = '';

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const start = parseFloat(formData.get('start') as string);
        const duration = parseFloat(formData.get('duration') as string);
        const format = formData.get('format') as string;

        // Audio Settings
        const bitrate = formData.get('bitrate') as string || '192k';
        const sampleRate = formData.get('sampleRate') as string || '44100';
        const channels = formData.get('channels') as string || '2';
        const volume = parseFloat(formData.get('volume') as string || '1');
        const fadeIn = parseFloat(formData.get('fadeIn') as string || '0');
        const fadeOut = parseFloat(formData.get('fadeOut') as string || '0');
        const fps = formData.get('fps') as string || 'original';

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const fileExt = file.name.split('.').pop() || 'tmp';
        inputPath = join(tempDir, `${id}_input.${fileExt}`);
        outputPath = join(tempDir, `${id}_output.${format}`);

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

            // Audio Filters
            const filters = [];

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
        await unlink(inputPath).catch((e) => console.error('Cleanup input warning:', e));
        await unlink(outputPath).catch((e) => console.error('Cleanup output warning:', e));

        const mimeType = format === 'wav' ? 'audio/wav' :
            format === 'flac' ? 'audio/flac' :
                format === 'mp3' ? 'audio/mpeg' :
                    'video/mp4';

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
        if (inputPath) await unlink(inputPath).catch((e) => console.error('Final cleanup input warning:', e));
        if (outputPath) await unlink(outputPath).catch((e) => console.error('Final cleanup output warning:', e));

        return NextResponse.json({
            error: 'Processing failed',
            details: err.message || String(err)
        }, { status: 500 });
    }
}
