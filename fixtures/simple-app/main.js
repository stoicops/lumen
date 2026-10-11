const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const window = new BrowserWindow({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
window.loadFile('index.html');
ipcMain.handle('greeting', (_event, name) => `Hello ${name}`);
