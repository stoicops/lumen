const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('studio', Object.freeze({
  choose: () => ipcRenderer.invoke('choose'),
  analyze: path => ipcRenderer.invoke('analyze', path),
  cancel: () => ipcRenderer.invoke('cancel'),
  projects: () => ipcRenderer.invoke('projects'),
  project: id => ipcRenderer.invoke('project', id),
  events: id => ipcRenderer.invoke('events', id),
  remove: id => ipcRenderer.invoke('delete', id),
  architecture: id => ipcRenderer.invoke('map', id),
  security: id => ipcRenderer.invoke('security', id),
  platform: () => ipcRenderer.invoke('platform'),
  models: () => ipcRenderer.invoke('models'),
  ask: request => ipcRenderer.invoke('ask', request),
  stopAsk: requestId => ipcRenderer.invoke('stopAsk', requestId),
  conversations: projectId => ipcRenderer.invoke('conversations', projectId),
  conversation: id => ipcRenderer.invoke('conversation', id),
  deleteConversation: id => ipcRenderer.invoke('deleteConversation', id),
  onChat: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('chat', listener); return () => ipcRenderer.removeListener('chat', listener); },
  copyMarkdown: id => ipcRenderer.invoke('copyMarkdown', id),
  exportReport: id => ipcRenderer.invoke('export', id),
  droppedPath: file => webUtils.getPathForFile(file),
  onProgress: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('progress', listener); return () => ipcRenderer.removeListener('progress', listener); }
}));
