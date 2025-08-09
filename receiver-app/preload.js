const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('receiver', {
  // Subscriptions management
  listSubscriptions: () => ipcRenderer.invoke('subscriptions:list'),
  addSubscription: (id, resolveUrl) => ipcRenderer.invoke('subscriptions:add', { id, resolveUrl }),
  removeSubscription: (id) => ipcRenderer.invoke('subscriptions:remove', id),
  // Resolve and notifications
  resolveChannel: (id, resolveUrl) => ipcRenderer.invoke('resolve-channel', id, resolveUrl),
  showNotification: (payload) => ipcRenderer.send('show-notification', payload),
});
