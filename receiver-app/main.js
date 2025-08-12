const { app, BrowserWindow, Notification, dialog, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let mainWindow;
let tray;
const DEFAULT_RESOLVE_URL = 'https://routed-gbiz.onrender.com';
const storePath = () => path.join(app.getPath('userData'), 'subscriptions.json');
const devStorePath = () => path.join(app.getPath('userData'), 'dev.json');

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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Routed',
    icon: path.join(__dirname, 'arrow-icon-routed.png'),
  });

  await mainWindow.loadFile('renderer.html');
  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide(); });
}

function createTray() {
  const trayImg = nativeImage.createFromPath(path.join(__dirname, 'arrow-icon-routed.png'));
  try { trayImg.setTemplateImage(false); } catch {}
  tray = new Tray(trayImg);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Quit Routed', click: () => { app.exit(0); } },
  ]);
  tray.setToolTip('Routed');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.whenReady().then(async () => {
  try { app.setName('Routed'); } catch {}
  if (process.platform === 'darwin') {
    try { app.dock.setIcon(path.join(__dirname, 'arrow-icon-routed.png')); } catch {}
  }
  await createWindow();
  createTray();
  // Start minimized to tray
  try { if (process.platform === 'darwin') app.dock.hide(); } catch {}
});

app.on('window-all-closed', () => {
  // Keep app running in tray on macOS
  if (process.platform !== 'darwin') app.quit();
});

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
});

// Developer/Channels IPC
ipcMain.handle('dev:get', async () => {
  return loadDev();
});

ipcMain.handle('dev:provision', async () => {
  try {
    const res = await fetch(new URL('/api/dev/create', DEFAULT_RESOLVE_URL).toString(), { method: 'POST', cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) throw new Error(`provision failed ${res.status} ${JSON.stringify(j)}`);
    const dev = { hubUrl: j.hubUrl, tenantId: j.tenantId, apiKey: j.apiKey, userId: j.userId };
    saveDev(dev);
    return dev;
  } catch (e) {
    dialog.showErrorBox('Provision failed', String(e));
    return null;
  }
});

ipcMain.handle('admin:channels:list', async (_evt, tenantId) => {
  try {
    const url = new URL(`/api/admin/channels/list?tenantId=${encodeURIComponent(tenantId)}`, DEFAULT_RESOLVE_URL).toString();
    const res = await fetch(url, { cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j.channels || [];
  } catch (e) {
    dialog.showErrorBox('List channels failed', String(e));
    return [];
  }
});

ipcMain.handle('admin:channels:create', async (_evt, { tenantId, name, topic }) => {
  try {
    const res = await fetch(new URL('/api/admin/channels/create', DEFAULT_RESOLVE_URL).toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, name, topic }), cache: 'no-store'
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j;
  } catch (e) {
    dialog.showErrorBox('Create channel failed', String(e));
    return null;
  }
});

ipcMain.handle('admin:channels:users', async (_evt, shortId) => {
  try {
    const res = await fetch(new URL(`/api/admin/channels/users/${encodeURIComponent(shortId)}`, DEFAULT_RESOLVE_URL).toString(), { cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j.users || [];
  } catch (e) {
    dialog.showErrorBox('Fetch channel users failed', String(e));
    return [];
  }
});

ipcMain.handle('admin:users:ensure', async (_evt, { tenantId, phone, topic }) => {
  try {
    const res = await fetch(new URL('/api/resolve', DEFAULT_RESOLVE_URL).toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, phone, topic }), cache: 'no-store'
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j;
  } catch (e) {
    dialog.showErrorBox('Add user failed', String(e));
    return null;
  }
});

ipcMain.handle('dev:sendMessage', async (_evt, { topic, title, body, payload }) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.hubUrl || !dev.apiKey) throw new Error('Developer not provisioned');
    const res = await fetch(new URL('/v1/messages', dev.hubUrl).toString(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dev.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, body, payload: payload ?? null }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j;
  } catch (e) {
    dialog.showErrorBox('Send failed', String(e));
    return null;
  }
});

ipcMain.on('app:show', () => { try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); if (process.platform === 'darwin') app.dock.show(); } } catch {} });
