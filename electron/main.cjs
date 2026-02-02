const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.replace('app.asar', 'app.asar.unpacked'));

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        titleBarStyle: 'hiddenInset', // Native look for macOS
        backgroundColor: '#020617', // Slate-950
        icon: path.join(__dirname, 'icon.png')
    });

    if (!app.isPackaged) {
        const port = process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || '3000';
        win.loadURL(`http://localhost:${port}`);
        // win.webContents.openDevTools({ mode: 'detach' });
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

// IPC Handlers
ipcMain.handle('select-save-path', async (event, defaultPath) => {
    const { filePath } = await dialog.showSaveDialog({
        defaultPath: defaultPath,
        buttonLabel: 'Exportieren',
    });
    return filePath;
});

ipcMain.handle('extract-media', async (event, { inputPath, outputPath, start, duration, format }) => {
    return new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath)
            .setStartTime(start)
            .setDuration(duration);

        if (format === 'wav') {
            command = command.noVideo().audioCodec('pcm_s16le');
        } else {
            // High quality video copy if possible, otherwise re-encode
            command = command.videoCodec('libx264').audioCodec('aac');
        }

        command
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                reject(err);
            })
            .on('end', () => {
                resolve(outputPath);
            })
            .save(outputPath);
    });
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
