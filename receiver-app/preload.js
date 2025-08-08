const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('receiver', {
  resolveCode: (code, resolveUrl) => ipcRenderer.invoke('resolve-code', code, resolveUrl),
  showNotification: (payload) => ipcRenderer.send('show-notification', payload),
});
