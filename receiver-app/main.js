// Routed Receiver App
// This app is used to receive messages from the Routed Hub.
// It is a simple Electron app that uses the Routed Hub API to receive messages.
// It is used to receive messages from the Routed Hub.

const { app, BrowserWindow, Notification, dialog, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let mainWindow;
let tray;
let isQuitting = false;
// Point app directly at the hub for all actions
let OVERRIDE_BASE = null;
const DEFAULT_RESOLVE_URL_FALLBACK = 'https://routed.onrender.com';
function readEnvFile(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const out = {};
    txt.split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) return;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
      out[m[1]] = v;
    });
    return out;
  } catch { return {}; }
}
function tryLoadLocalEnv() {
  const homes = [];
  try { homes.push(path.join(app.getPath('home') || '', '.routed', '.env')); } catch {}
  try { homes.push(path.join(app.getPath('userData') || '', '.env')); } catch {}
  // Dev locations
  try { homes.push(path.join(__dirname, '.env')); } catch {}
  try { homes.push(path.join(process.cwd(), 'receiver-app', '.env')); } catch {}
  let env = {};
  for (const f of homes) {
    const e = readEnvFile(f);
    env = { ...env, ...e };
  }
  const hub = env.HUB_URL || env.BASE_URL;
  if (hub) OVERRIDE_BASE = hub;
  if (env.HUB_ADMIN_TOKEN) process.env.HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || env.HUB_ADMIN_TOKEN;
}
try { tryLoadLocalEnv(); } catch {}

function baseUrl() {
  const fromEnv = OVERRIDE_BASE || process.env.HUB_URL || process.env.BASE_URL;
  const d = (() => { try { return loadDev(); } catch { return null; } })();
  if (d && d.hubUrl) return d.hubUrl;
  return fromEnv || DEFAULT_RESOLVE_URL_FALLBACK;
}

function adminAuthHeaders() {
  const h = {};
  if (process.env.HUB_ADMIN_TOKEN) h['Authorization'] = `Bearer ${process.env.HUB_ADMIN_TOKEN}`;
  return h;
}

function isAdminMode() {
  return !!process.env.HUB_ADMIN_TOKEN;
}
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
  const assetBase = app.isPackaged ? process.resourcesPath : __dirname;
  // Prefer platform-native icon bundle on macOS if available
  let appIconPath = path.join(assetBase, 'build', 'icon.icns');
  try { if (!fs.existsSync(appIconPath)) appIconPath = path.join(assetBase, 'routed_icon.png'); } catch { appIconPath = path.join(assetBase, 'routed_icon.png'); }
  mainWindow = new BrowserWindow({
    width: 560,
    height: 720,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Routed',
    icon: appIconPath,
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
  const assetBase = app.isPackaged ? process.resourcesPath : __dirname;
  const template1x = path.join(assetBase, 'assets', 'trayTemplate.png');
  const template2x = path.join(assetBase, 'assets', 'trayTemplate@2x.png');
  writeLog(`Tray: assetBase=${assetBase}`);
  writeLog(`Tray: template1x exists=${fs.existsSync(template1x)} path=${template1x}`);
  writeLog(`Tray: template2x exists=${fs.existsSync(template2x)} path=${template2x}`);

  let trayImg;
  try {
    if (fs.existsSync(template1x)) {
      trayImg = nativeImage.createFromPath(template1x);
      // If too large/small, normalize to 18x18 points for menu bar clarity
      const sz = trayImg.getSize?.();
      if (sz && (sz.width !== 18 || sz.height !== 18)) {
        try {
          trayImg = trayImg.resize({ width: 18, height: 18, quality: 'best' });
          writeLog(`Tray: resized 1x to 18x18`);
        } catch (e) { writeLog('Tray: resize 1x failed ' + String(e)); }
      }
      if (fs.existsSync(template2x)) {
        try {
          const buf2x = fs.readFileSync(template2x);
          trayImg.addRepresentation({ scaleFactor: 2.0, data: buf2x });
          writeLog('Tray: added @2x representation');
        } catch (e) { writeLog('Tray: add @2x failed ' + String(e)); }
      }
      try { trayImg.setTemplateImage(true); writeLog('Tray: setTemplateImage(true)'); } catch (e) { writeLog('Tray: setTemplateImage error ' + String(e)); }
    }
  } catch (e) { writeLog('Tray: error creating template image ' + String(e)); }

  // Fallback to app icon (non-template colored) if template assets missing or image empty
  if (!trayImg || trayImg.isEmpty?.()) {
    writeLog('Tray: using fallback app icon');
    trayImg = nativeImage.createFromPath(path.join(assetBase, 'routed_icon.png'));
    try { trayImg.setTemplateImage(false); } catch {}
  } else {
    writeLog(`Tray: final image size=${JSON.stringify(trayImg.getSize?.())}`);
  }

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
    const assetBase = app.isPackaged ? process.resourcesPath : __dirname;
    // Prefer the icns bundle for the dock if available
    let dockIcon = path.join(assetBase, 'build', 'icon.icns');
    try { if (!fs.existsSync(dockIcon)) dockIcon = path.join(assetBase, 'routed_icon.png'); } catch { dockIcon = path.join(assetBase, 'routed_icon.png'); }
    try { app.dock.setIcon(dockIcon); } catch {}
    // Ensure the app shows in the Dock and Force Quit menu
    try { app.setActivationPolicy?.('regular'); } catch {}
    try { app.dock.show(); } catch {}
  }
  // Register a global quit shortcut
  try {
    globalShortcut.register('Command+Q', () => { isQuitting = true; try { app.quit(); } catch {} });
  } catch {}

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
    store.subscriptions = [...(store.subscriptions || []), { id: sub.id, resolveUrl: sub.resolveUrl || DEFAULT_RESOLVE_URL_FALLBACK }];
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

ipcMain.handle('resolve-channel', async (_evt, id, resolveBaseUrl) => {
  try {
    const res = await fetch(new URL(`/api/channel/resolve/${encodeURIComponent(id)}`, resolveBaseUrl || DEFAULT_RESOLVE_URL_FALLBACK).toString(), { cache: 'no-store' });
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
  const url = (payload && payload.payload && payload.payload.url) ? String(payload.payload.url) : null;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    try {
      if (url) {
        writeLog('Notification click: opening ' + url);
        shell.openExternal(url).catch(() => {});
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    } catch {}
  });
  try { n.show(); } catch {}
  writeLog(`Notification shown: ${title} :: ${body} ${url ? '(url=' + url + ')' : ''}`);
});

ipcMain.handle('debug:log', async (_evt, line) => { writeLog(`[renderer] ${line}`); return true; });

// Quit + Version APIs
ipcMain.on('app:quit', () => { isQuitting = true; try { app.quit(); } catch {} });
ipcMain.handle('app:version', async () => {
  try { return app.getVersion ? app.getVersion() : '0.0.0'; } catch { return '0.0.0'; }
});

ipcMain.handle('admin:sockets', async () => {
  try {
    const headers = {};
    if (process.env.HUB_ADMIN_TOKEN) headers['Authorization'] = `Bearer ${process.env.HUB_ADMIN_TOKEN}`;
    const res = await fetch(new URL('/v1/admin/debug/sockets', baseUrl()).toString(), { cache: 'no-store', headers });
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
    const admin = isAdminMode();
    const url = new URL(admin ? '/v1/admin/sandbox/provision' : '/v1/dev/sandbox/provision', baseUrl()).toString();
    const opts = { method: 'POST', cache: 'no-store', headers: admin ? { ...adminAuthHeaders(), 'Content-Type': 'application/json' } : undefined };
    const res = await fetch(url, opts);
    const j = await res.json();
    if (!res.ok) throw new Error(`provision failed ${res.status} ${JSON.stringify(j)}`);
    const dev = { hubUrl: baseUrl(), tenantId: j.tenantId, apiKey: j.apiKey, userId: j.userId };
    saveDev(dev);
    writeLog(`provision → success tenantId=${dev.tenantId} (admin=${admin})`);
    return dev;
  } catch (e) {
    dialog.showErrorBox('Provision failed', String(e));
    writeLog(`dev:provision error: ${String(e)}`);
    return null;
  }
});

ipcMain.handle('dev:setBaseUrl', async (_evt, url) => {
  try {
    const d = loadDev() || {};
    d.hubUrl = (url || '').trim() || DEFAULT_RESOLVE_URL_FALLBACK;
    saveDev(d);
    writeLog(`dev:setBaseUrl → ${d.hubUrl}`);
    return d.hubUrl;
  } catch (e) {
    writeLog('dev:setBaseUrl error: ' + String(e));
    return baseUrl();
  }
});

ipcMain.handle('dev:getBaseUrl', async () => {
  return baseUrl();
});

ipcMain.handle('dev:setApiKey', async (_evt, key) => {
  try {
    const d = loadDev() || {};
    d.apiKey = (key || '').trim();
    saveDev(d);
    writeLog('dev:setApiKey → ' + (d.apiKey ? 'set' : 'cleared'));
    return true;
  } catch (e) {
    writeLog('dev:setApiKey error: ' + String(e));
    return false;
  }
});

ipcMain.handle('admin:channels:list', async (_evt, tenantId) => {
  try {
    const url = new URL(`/v1/dev/channels/list?tenant_id=${encodeURIComponent(tenantId)}`, baseUrl()).toString();
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
    const admin = isAdminMode();
    const url = new URL(admin ? '/v1/admin/channels/create' : '/v1/dev/channels/create', baseUrl()).toString();
    const headers = { 'Content-Type': 'application/json', ...(admin ? adminAuthHeaders() : {}) };
    const body = admin ? { tenant_id: tenantId, name, topic_name: topic } : { tenantId, name, topic };
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`channels:create → ok name=${name} (admin=${admin})`);
    return j;
  } catch (e) {
    dialog.showErrorBox('Create channel failed', String(e));
    writeLog(`channels:create error: ${String(e)}`);
    return null;
  }
});

ipcMain.handle('admin:channels:users', async (_evt, shortId) => {
  try {
    const res = await fetch(new URL(`/v1/dev/channels/${encodeURIComponent(shortId)}/users`, baseUrl()).toString(), { cache: 'no-store' });
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
    const admin = isAdminMode();
    const url = new URL(admin ? '/v1/admin/users/ensure' : '/v1/dev/users/ensure', baseUrl()).toString();
    const headers = { 'Content-Type': 'application/json', ...(admin ? adminAuthHeaders() : {}) };
    const body = admin ? { tenant_id: tenantId, phone, topic } : { tenant_id: tenantId, phone, topic };
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`users:ensure → ok tenant=${tenantId} phone=${phone} (admin=${admin})`);
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
    const b = dev.hubUrl || baseUrl();
    const res = await fetch(new URL('/v1/messages', b).toString(), {
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
