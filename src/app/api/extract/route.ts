import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Set ffmpeg path
// Using process.cwd() is essential in Next.js to reliably find node_modules on the server
const ffmpegPath = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
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

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const fileExt = file.name.split('.').pop() || 'tmp';
        inputPath = join(tempDir, `${id}_input.${fileExt}`);
        outputPath = join(tempDir, `${id}_output.${format}`);

        const bytes = await file.arrayBuffer();
        await writeFile(inputPath, Buffer.from(bytes));

        // Process to file
        await new Promise((resolve, reject) => {
            let command = ffmpeg(inputPath)
                .setStartTime(start)
                .setDuration(duration);

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
                command = command
                    .videoCodec('libx264')
                    .audioCodec('aac')
                    .audioBitrate(bitrate)
                    .format('mp4')
                    .outputOptions([
                        '-pix_fmt yuv420p',
                        '-movflags +faststart'
                    ]);
            }

            // Apply shared audio properties
            if (format !== 'mp4') {
                command = command
                    .audioChannels(parseInt(channels))
                    .audioFrequency(parseInt(sampleRate));
            }

            // Audio Filters
            const filters = [];

            // Volume
            if (volume !== 1) {
                filters.push(`volume=${volume}`);
            }

            // Fade In
            if (fadeIn > 0) {
                filters.push(`afade=t=in:st=0:d=${fadeIn}`);
            }

            // Fade Out
            if (fadeOut > 0) {
                // st (start time) for fade out is duration - fadeOut duration
                const fadeOutStart = Math.max(0, duration - fadeOut);
                filters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
            }

            if (filters.length > 0) {
                command = command.audioFilters(filters);
            }

            command
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    reject(err);
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

    } catch (error: any) {
        console.error('API Error:', error);

        // Final cleanup attempt
        if (inputPath) await unlink(inputPath).catch((e) => console.error('Final cleanup input warning:', e));
        if (outputPath) await unlink(outputPath).catch((e) => console.error('Final cleanup output warning:', e));

        return NextResponse.json({
            error: 'Processing failed',
            details: error.message || String(error)
        }, { status: 500 });
    }
}
