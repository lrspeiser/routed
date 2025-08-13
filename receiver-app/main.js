// Routed Receiver App
// This app is used to receive messages from the Routed Hub.
// It is a simple Electron app that uses the Routed Hub API to receive messages.
// It is used to receive messages from the Routed Hub.

const { app, BrowserWindow, Notification, dialog, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let mainWindow;
let tray;
let isQuitting = false;
// Point app directly at the hub for all actions
const DEFAULT_RESOLVE_URL = 'https://routed.onrender.com';
const storePath = () => path.join(app.getPath('userData'), 'subscriptions.json');
const devStorePath = () => path.join(app.getPath('userData'), 'dev.json');
function resolveLogPath() {
  try {
    // In packaged app, always write to userData (writable)
    if (app.isPackaged) return path.join(app.getPath('userData'), 'routed.log');
    // In dev, write alongside sources for convenience
    return path.join(__dirname, 'routed.log');
  } catch {
    return path.join(process.cwd(), 'routed.log');
  }
}

function writeLog(line) {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}\n`;
  try { fs.appendFileSync(resolveLogPath(), out); } catch {}
  try { console.log(out.trim()); } catch {}
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return { subscriptions: [] }; }
}
function saveStore(data) {
  try { fs.writeFileSync(storePath(), JSON.stringify(data, null, 2)); } catch {}
}

function loadDev() {
  try { return JSON.parse(fs.readFileSync(devStorePath(), 'utf8')); } catch { return null; }
}
function saveDev(data) {
  try { fs.writeFileSync(devStorePath(), JSON.stringify(data, null, 2)); } catch {}
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 720,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Routed',
    icon: path.join(__dirname, 'routed_icon.png'),
  });

  await mainWindow.loadFile('renderer.html');
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    } else {
      // allow default close on quit
    }
  });
  writeLog('Main window created');
}

function createTray() {
  const trayImg = nativeImage.createFromPath(path.join(__dirname, 'routed_icon.png'));
  try { trayImg.setTemplateImage(false); } catch {}
  tray = new Tray(trayImg);
  const login = app.getLoginItemSettings?.() || { openAtLogin: false };
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Test Notification', click: () => {
      const test = { title: 'Routed', body: 'Test notification' };
      const n = new Notification(test);
      n.on('click', () => { try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } catch {} });
      try { n.show(); } catch {}
      writeLog('Tray: Test Notification triggered');
    } },
    { type: 'separator' },
    { label: login.openAtLogin ? 'Disable Open at Login' : 'Enable Open at Login', click: () => {
      try {
        const cur = app.getLoginItemSettings?.() || { openAtLogin: false };
        app.setLoginItemSettings?.({ openAtLogin: !cur.openAtLogin });
        writeLog(`Tray: Open at Login → ${!cur.openAtLogin}`);
      } catch (e) { writeLog('Tray: setLoginItemSettings error ' + String(e)); }
    } },
    { type: 'separator' },
    { label: 'Quit Routed', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Routed');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.whenReady().then(async () => {
  try { app.setName('Routed'); } catch {}
  if (process.platform === 'darwin') {
    try { app.dock.setIcon(path.join(__dirname, 'routed_icon.png')); } catch {}
    // Hide Dock for menu-bar-only behavior; app accessible via tray icon
    try { app.dock.hide(); } catch {}
  }
  await createWindow();
  createTray();
  writeLog('App ready');

  // Basic app menu with Quit for macOS
  try {
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Quit', accelerator: 'Command+Q', click: () => { isQuitting = true; app.quit(); } },
        ],
      }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'Quit', accelerator: isMac ? 'Command+Q' : 'Ctrl+Q', click: () => { isQuitting = true; app.quit(); } },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch {}
});

app.on('window-all-closed', () => {
  // Keep app running in tray on macOS
  if (process.platform !== 'darwin') app.quit();
  writeLog('All windows closed');
});

app.on('activate', () => {
  try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } catch {}
  writeLog('App activated');
});

app.on('before-quit', () => { isQuitting = true; });

ipcMain.handle('subscriptions:list', async () => {
  return loadStore().subscriptions || [];
});

ipcMain.handle('subscriptions:add', async (_evt, sub) => {
  const store = loadStore();
  const exists = (store.subscriptions || []).some((s) => s.id === sub.id);
  if (!exists) {
    store.subscriptions = [...(store.subscriptions || []), { id: sub.id, resolveUrl: sub.resolveUrl || DEFAULT_RESOLVE_URL }];
    saveStore(store);
  }
  return store.subscriptions;
});

ipcMain.handle('subscriptions:remove', async (_evt, id) => {
  const store = loadStore();
  store.subscriptions = (store.subscriptions || []).filter((s) => s.id !== id);
  saveStore(store);
  return store.subscriptions;
});

ipcMain.handle('resolve-channel', async (_evt, id, resolveBaseUrl) => {
  try {
    const res = await fetch(new URL(`/api/channel/resolve/${encodeURIComponent(id)}`, resolveBaseUrl || DEFAULT_RESOLVE_URL).toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`resolve failed ${res.status}`);
    return await res.json();
  } catch (e) {
    dialog.showErrorBox('Resolve failed', String(e));
    writeLog(`resolve-channel error: ${String(e)}`);
    return null;
  }
});

ipcMain.on('show-notification', (_evt, payload) => {
  const title = payload.title || 'Notification';
  const body = payload.body || '';
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } catch {}
  });
  try { n.show(); } catch {}
  writeLog(`Notification shown: ${title} :: ${body}`);
});

ipcMain.handle('debug:log', async (_evt, line) => { writeLog(`[renderer] ${line}`); return true; });

// Expose app version to renderer
ipcMain.handle('app:version', async () => {
  try { return app.getVersion ? app.getVersion() : '0.0.0'; } catch { return '0.0.0'; }
});

ipcMain.handle('admin:sockets', async () => {
  try {
    const res = await fetch(new URL('/v1/admin/debug/sockets', process.env.HUB_URL || 'https://routed.onrender.com').toString(), { cache: 'no-store' });
    const j = await res.json();
    writeLog(`admin:sockets → ${JSON.stringify(j)}`);
    return j;
  } catch (e) {
    writeLog(`admin:sockets error: ${String(e)}`);
    return null;
  }
});

// Developer/Channels IPC
ipcMain.handle('dev:get', async () => {
  const d = loadDev();
  writeLog(`dev:get → ${d ? 'ok' : 'none'}`);
  return d;
});

ipcMain.handle('dev:provision', async () => {
  try {
    const res = await fetch(new URL('/v1/dev/sandbox/provision', DEFAULT_RESOLVE_URL).toString(), { method: 'POST', cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) throw new Error(`provision failed ${res.status} ${JSON.stringify(j)}`);
    const dev = { hubUrl: DEFAULT_RESOLVE_URL, tenantId: j.tenantId, apiKey: j.apiKey, userId: j.userId };
    saveDev(dev);
    writeLog(`dev:provision → success tenantId=${dev.tenantId}`);
    return dev;
  } catch (e) {
    dialog.showErrorBox('Provision failed', String(e));
    writeLog(`dev:provision error: ${String(e)}`);
    return null;
  }
});

ipcMain.handle('admin:channels:list', async (_evt, tenantId) => {
  try {
    const url = new URL(`/v1/dev/channels/list?tenant_id=${encodeURIComponent(tenantId)}`, DEFAULT_RESOLVE_URL).toString();
    const res = await fetch(url, { cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`channels:list → ${Array.isArray(j.channels)? j.channels.length: 0}`);
    return j.channels || [];
  } catch (e) {
    dialog.showErrorBox('List channels failed', String(e));
    writeLog(`channels:list error: ${String(e)}`);
    return [];
  }
});

ipcMain.handle('admin:channels:create', async (_evt, { tenantId, name, topic }) => {
  try {
    const res = await fetch(new URL('/v1/dev/channels/create', DEFAULT_RESOLVE_URL).toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, name, topic }), cache: 'no-store'
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`channels:create → ok name=${name}`);
    return j;
  } catch (e) {
    dialog.showErrorBox('Create channel failed', String(e));
    writeLog(`channels:create error: ${String(e)}`);
    return null;
  }
});

ipcMain.handle('admin:channels:users', async (_evt, shortId) => {
  try {
    const res = await fetch(new URL(`/v1/dev/channels/${encodeURIComponent(shortId)}/users`, DEFAULT_RESOLVE_URL).toString(), { cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`channels:users(${shortId}) → ${Array.isArray(j.users)? j.users.length: 0}`);
    return j.users || [];
  } catch (e) {
    dialog.showErrorBox('Fetch channel users failed', String(e));
    writeLog(`channels:users error: ${String(e)}`);
    return [];
  }
});

ipcMain.handle('admin:users:ensure', async (_evt, { tenantId, phone, topic }) => {
  try {
    const res = await fetch(new URL('/v1/dev/users/ensure', DEFAULT_RESOLVE_URL).toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, phone, topic }), cache: 'no-store'
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`users:ensure → ok tenant=${tenantId} phone=${phone}`);
    return j;
  } catch (e) {
    dialog.showErrorBox('Add user failed', String(e));
    writeLog(`users:ensure error: ${String(e)}`);
    return null;
  }
});

ipcMain.handle('dev:sendMessage', async (_evt, { topic, title, body, payload }) => {
  try {
    let dev = loadDev();
    if (!dev || !dev.apiKey) {
      writeLog('sendMessage: provisioning because developer not provisioned');
      await (async () => ipcMain.handlers?.['dev:provision']?.({}, {}) )?.();
      dev = loadDev();
    }
    if (!dev || !dev.apiKey) throw new Error('Developer not provisioned');
    const baseUrl = dev.hubUrl || DEFAULT_RESOLVE_URL;
    const res = await fetch(new URL('/v1/messages', baseUrl).toString(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dev.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, body, payload: payload ?? null }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`sendMessage → ok topic=${topic} title=${title}`);
    return j;
  } catch (e) {
    dialog.showErrorBox('Send failed', String(e));
    writeLog(`sendMessage error: ${String(e)}`);
    return null;
  }
});

ipcMain.on('app:show', () => { try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); if (process.platform === 'darwin') app.dock.show(); } } catch {} });
