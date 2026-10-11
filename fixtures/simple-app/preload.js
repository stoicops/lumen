const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('greetings', { hello: name => ipcRenderer.invoke('greeting', name) });
