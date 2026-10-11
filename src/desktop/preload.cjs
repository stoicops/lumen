const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('studio', Object.freeze({
  choose: () => ipcRenderer.invoke('choose'),
  analyze: path => ipcRenderer.invoke('analyze', path),
  cancel: () => ipcRenderer.invoke('cancel'),
  projects: () => ipcRenderer.invoke('projects'),
  models: () => ipcRenderer.invoke('models'),
  ask: request => ipcRenderer.invoke('ask', request),
  exportReport: id => ipcRenderer.invoke('export', id),
  droppedPath: file => webUtils.getPathForFile(file),
  onProgress: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('progress', listener); return () => ipcRenderer.removeListener('progress', listener); }
}));
