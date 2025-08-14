const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('receiver', {
  // Subscriptions management
  listSubscriptions: () => ipcRenderer.invoke('subscriptions:list'),
  addSubscription: (id, resolveUrl) => ipcRenderer.invoke('subscriptions:add', { id, resolveUrl }),
  removeSubscription: (id) => ipcRenderer.invoke('subscriptions:remove', id),
  // Resolve and notifications
  resolveChannel: (id, resolveUrl) => ipcRenderer.invoke('resolve-channel', id, resolveUrl),
  showNotification: (payload) => ipcRenderer.send('show-notification', payload),
  debugLog: (line) => ipcRenderer.invoke('debug:log', line),
  adminSockets: () => ipcRenderer.invoke('admin:sockets'),
  // App + Dev
  appShow: () => ipcRenderer.send('app:show'),
  appQuit: () => ipcRenderer.send('app:quit'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  devGet: () => ipcRenderer.invoke('dev:get'),
  devProvision: () => ipcRenderer.invoke('dev:provision'),
  devSetBaseUrl: (url) => ipcRenderer.invoke('dev:setBaseUrl', url),
  devGetBaseUrl: () => ipcRenderer.invoke('dev:getBaseUrl'),
  adminChannelsList: (tenantId) => ipcRenderer.invoke('admin:channels:list', tenantId),
  adminChannelsCreate: (args) => ipcRenderer.invoke('admin:channels:create', args),
  adminChannelsUsers: (shortId) => ipcRenderer.invoke('admin:channels:users', shortId),
  adminUsersEnsure: (args) => ipcRenderer.invoke('admin:users:ensure', args),
  devSendMessage: (args) => ipcRenderer.invoke('dev:sendMessage', args),
  devSetApiKey: (key) => ipcRenderer.invoke('dev:setApiKey', key),
  // Verification
  verifyStart: (args) => ipcRenderer.invoke('verify:start', args),
  verifyCheck: (args) => ipcRenderer.invoke('verify:check', args),
});
