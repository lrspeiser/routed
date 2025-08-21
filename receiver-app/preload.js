const { contextBridge, ipcRenderer } = require('electron');

const ALLOW_INVOKE = new Set([
  'verify:start','verify:check','auth:logout',
  'channels:list','channels:create','channels:users','channels:subscribe','channels:unsubscribe','channels:send',
  'public:channels:join','public:channels:list','public:channels:leave',
  'debug:log',
  'subscriptions:list', 'subscriptions:add', 'subscriptions:remove', 'resolve-channel', 
  'admin:sockets', 'app:show', 'app:quit', 'app:version', 'app:logs:read', 
  'app:logs:path', 'app:logs:poke', 'app:openExternal', 'dev:get', 'dev:provision', 
  'dev:setBaseUrl', 'dev:getBaseUrl', 'admin:channels:list', 'admin:channels:create', 
  'users:channels:list', 'admin:channels:users', 'admin:users:ensure', 
  'dev:sendMessage', 'dev:setApiKey', 'dev:channels:subscribe', 'auth:completeSms', 
  'auth:logout', 'auth:logoutAll', 'dev:reset', 'verify:start', 'verify:check', 'devtools:toggle'
]);

contextBridge.exposeInMainWorld('receiver', {
  invoke: (ch, payload) => ALLOW_INVOKE.has(ch) ? ipcRenderer.invoke(ch, payload) : Promise.resolve(undefined),
  verifyStart: (payload) => ipcRenderer.invoke('verify:start', payload),
  verifyCheck: (payload) => ipcRenderer.invoke('verify:check', payload),
  send: (ch, payload) => {
    const validChannels = ['login-success', 'renderer-ready'];
    if (validChannels.includes(ch)) {
      ipcRenderer.send(ch, payload);
    }
  },
  on: (ch, cb) => {
    const validChannels = ['log', 'dev:updated', 'request-phone-auth', 'init-state'];
    if (validChannels.includes(ch)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(ch, (event, ...args) => cb(...args));
    }
  },
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
