const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file) => webUtils.getPathForFile(file),
    extractMedia: (options) => ipcRenderer.invoke('extract-media', options),
    selectSavePath: (defaultPath) => ipcRenderer.invoke('select-save-path', defaultPath),
});
