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
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
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
  devChannelsSubscribe: (shortId, phone) => ipcRenderer.invoke('dev:channels:subscribe', { shortId, phone }),
  // Auth
  authCompleteSms: (args) => ipcRenderer.invoke('auth:completeSms', args),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authLogoutAll: () => ipcRenderer.invoke('auth:logoutAll'),
  // Maintenance
  devReset: () => ipcRenderer.invoke('dev:reset'),
  // Verification
  verifyStart: (args) => ipcRenderer.invoke('verify:start', args),
  verifyCheck: (args) => ipcRenderer.invoke('verify:check', args),
});

// Scripts bridge (scaffold)
contextBridge.exposeInMainWorld('scripts', {
  list: () => ipcRenderer.invoke('scripts:list'),
  get: (id) => ipcRenderer.invoke('scripts:get', id),
  create: (payload) => ipcRenderer.invoke('scripts:create', payload),
  update: (id, payload) => ipcRenderer.invoke('scripts:update', { id, payload }),
  remove: (id) => ipcRenderer.invoke('scripts:delete', id),
  enableToggle: (id, enabled) => ipcRenderer.invoke('scripts:enableToggle', { id, enabled }),
  runNow: (id) => ipcRenderer.invoke('scripts:runNow', id),
  test: (id) => ipcRenderer.invoke('scripts:test', id),
  logsTail: (id) => ipcRenderer.invoke('scripts:logs:tail', id),
  logsRead: (id) => ipcRenderer.invoke('scripts:logs:read', id),
  logsClear: (id) => ipcRenderer.invoke('scripts:logs:clear', id),
  webhookUrl: (id) => ipcRenderer.invoke('scripts:webhook:url', id),
  aiGenerate: (args) => ipcRenderer.invoke('scripts:ai:generate', args),
});
