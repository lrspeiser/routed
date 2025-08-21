// Routed Receiver App
// This app is used to receive messages from the Routed Hub.
// It is a simple Electron app that uses the Routed Hub API to receive messages.
// It is used to receive messages from the Routed Hub.

const { app, BrowserWindow, Notification, dialog, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell, session } = require('electron');
const path = require('path');

// Handle runtime-service import for both dev and packaged app
let createRuntimeService, registerIpc;
try {
  // Try packaged app path first (inside app.asar)
  const packagedPath = path.join(__dirname, 'packages', 'runtime-service', 'dist');
  ({ createRuntimeService, registerIpc } = require(packagedPath));
} catch (e1) {
  try {
    // Fall back to development path
    ({ createRuntimeService, registerIpc } = require('../packages/runtime-service/dist'));
  } catch (e2) {
    console.error('Failed to load runtime-service:', e2);
    // Provide stub functions to prevent crashes
    createRuntimeService = () => ({ subscribe: () => {}, publish: () => {} });
    registerIpc = () => {};
  }
}
const fs = require('fs');
const os = require('os');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
let keytar; try { keytar = require('keytar'); } catch { keytar = null; }

let mainWindow;
let verifyWindow;
let tray;
let isQuitting = false;
// Point app to runtime service; hub access is only via service
let OVERRIDE_BASE = null;
// Post-verification initialization gate
let _postInitDone = false;
// Clean start flag: when set, app clears all local user state on startup
const CLEAN_START = process.argv.includes('--clean-start') || process.env.CLEAN_START === '1';
const DEFAULT_RESOLVE_URL_FALLBACK = 'https://routed.onrender.com';
// Suppress modal error popups for background operations; rely on log and renderer toasts
const QUIET_ERRORS = true;
function readEnvFile(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const out = {};
    txt.split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) return;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith(`'`) && v.endsWith(`'`))) v = v.slice(1,-1);
      out[m[1]] = v;
    });
    return out;
  } catch { return {}; }
}
function tryLoadLocalEnv() {
  const homes = [];
  try { homes.push(path.join(app.getPath('home') || '', '.routed', '.env')); } catch {}
  try { homes.push(path.join(app.getPath('userData') || '', '.env')); } catch {}
  // Packaged resources (bundled into app)
  try {
    const resBase = app.isPackaged ? process.resourcesPath : __dirname;
    homes.push(path.join(resBase, 'resources', '.env'));
    homes.push(path.join(resBase, 'resources', 'ai', '.env'));
    homes.push(path.join(resBase, 'resources', 'ai', 'openai.env'));
    homes.push(path.join(resBase, 'resources', 'ai', 'openai.key'));
  } catch {}
  // Dev locations
  try { homes.push(path.join(__dirname, '.env')); } catch {}
  try { homes.push(path.join(process.cwd(), 'receiver-app', '.env')); } catch {}
  let env = {};
  for (const f of homes) {
    const e = readEnvFile(f);
    env = { ...env, ...e };
  }
  // Also support raw key file at resources/ai/openai.key
  try {
    const resBase = app.isPackaged ? process.resourcesPath : __dirname;
    const keyFile = path.join(resBase, 'resources', 'ai', 'openai.key');
    if (!env.OPENAI_API_KEY && fs.existsSync(keyFile)) {
      env.OPENAI_API_KEY = fs.readFileSync(keyFile, 'utf8').trim();
    }
    // Optional project/org/base overrides
    const projFile = path.join(resBase, 'resources', 'ai', 'openai.project');
    const orgFile = path.join(resBase, 'resources', 'ai', 'openai.org');
    const baseFile = path.join(resBase, 'resources', 'ai', 'openai.base_url');
    if (!env.OPENAI_PROJECT && fs.existsSync(projFile)) env.OPENAI_PROJECT = fs.readFileSync(projFile, 'utf8').trim();
    if (!env.OPENAI_ORG && fs.existsSync(orgFile)) env.OPENAI_ORG = fs.readFileSync(orgFile, 'utf8').trim();
    if (!env.OPENAI_BASE_URL && fs.existsSync(baseFile)) env.OPENAI_BASE_URL = fs.readFileSync(baseFile, 'utf8').trim().replace(/\/$/, '');
  } catch {}
  const hub = env.HUB_URL || env.BASE_URL;
  if (hub) OVERRIDE_BASE = hub;
  if (env.HUB_ADMIN_TOKEN) process.env.HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || env.HUB_ADMIN_TOKEN;
  if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (env.OPENAI_PROJECT) process.env.OPENAI_PROJECT = process.env.OPENAI_PROJECT || env.OPENAI_PROJECT;
  if (env.OPENAI_ORG) process.env.OPENAI_ORG = process.env.OPENAI_ORG || env.OPENAI_ORG;
  if (env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || env.OPENAI_BASE_URL;
}

// Read/write OpenAI key under userData so the server can provision it for the app
function userDataAIPath(...segs) {
  try { return path.join(app.getPath('userData'), 'ai', ...segs); } catch { return path.join(process.cwd(), 'ai', ...segs); }
}
// IMPORTANT: NEVER use placeholder or fallback keys for OpenAI. Only use a valid, server-provisioned key bound to the authorized user.
// Key validity is strictly structural (non-empty, long enough, no whitespace). No placeholder acceptance of any kind.
function isStructurallyValidOpenAIKey(key) {
  return typeof key === 'string' && key.startsWith('sk-') && key.length > 40;
}
function tryReadUserOpenAIKey() {
  try {
    const p = userDataAIPath('openai.key');
    if (fs.existsSync(p)) {
      const k = (fs.readFileSync(p, 'utf8') || '').trim();
      if (!isStructurallyValidOpenAIKey(k)) {
        writeLog('openai:key_read invalid; treating as missing (no placeholders, no fallbacks)');
        return null;
      }
      return k;
    }
  } catch {}
  return null;
}
function persistUserOpenAIKey(key) {
  try {
    if (!key) return false;
    const k = String(key).trim();
    if (!isStructurallyValidOpenAIKey(k)) {
      writeLog('openai:key_persist rejected (invalid structure). Placeholders/fallbacks are forbidden.');
      return false;
    }
    const dir = userDataAIPath();
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const p = userDataAIPath('openai.key');
    fs.writeFileSync(p, k);
    return true;
  } catch { return false; }
}

  // IMPORTANT: Do not rely on env OPENAI_* for generation. Only server-provisioned keys stored under userData are used.
try { tryLoadLocalEnv(); } catch {}
// Start runtime service and register IPC
let _service;
app.whenReady().then(() => {
  const base = OVERRIDE_BASE || process.env.HUB_URL || process.env.BASE_URL || DEFAULT_RESOLVE_URL_FALLBACK;
  try { _service = createRuntimeService(base); registerIpc(_service); } catch (e) { writeLog('runtime-service init error: ' + String(e)); }
});

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

// Clean local state (Electron storage + userData + keychain tokens)
async function cleanLocalState() {
  try {
    writeLog('clean-start: begin');
    // 1) Clear Electron session storage/caches
    try {
      if (session && session.defaultSession) {
        await session.defaultSession.clearStorageData({});
        await session.defaultSession.clearCache();
        writeLog('clean-start: cleared session storage and cache');
      }
    } catch (e) { writeLog('clean-start: session clear error ' + String(e)); }

    // 2) Delete all files under userData
    try {
      const ud = app.getPath('userData');
      writeLog('clean-start: userData=' + ud);
      try {
        const entries = fs.readdirSync(ud);
        for (const name of entries) {
          try { fs.rmSync(path.join(ud, name), { recursive: true, force: true }); } catch {}
        }
        writeLog('clean-start: wiped userData contents');
      } catch (e) { writeLog('clean-start: userData wipe error ' + String(e)); }
    } catch (e) { writeLog('clean-start: userData path error ' + String(e)); }

    // 3) Clear keychain-backed session tokens
    try { await tmClear(); writeLog('clean-start: cleared keychain session tokens'); } catch (e) { writeLog('clean-start: keychain clear error ' + String(e)); }

    writeLog('clean-start: done');
  } catch (e) {
    writeLog('clean-start: fatal error ' + String(e));
  }
}

function withTimeoutSignal(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch {} }, ms);
  const cancel = () => { try { clearTimeout(t); } catch {} };
  return { signal: ac.signal, cancel };
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
  try { notifyDevUpdated(data); } catch {}
}

function notifyDevUpdated(data) {
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('dev:updated', data || loadDev());
    }
  } catch (e) { writeLog('notifyDevUpdated error: ' + String(e)); }
}

// Ensure we have a working developer identity (tenantId + apiKey) for the current baseUrl
async function ensureValidDeveloper() {
  try {
    let dev = loadDev();
    const b = baseUrl();
    // If no key at all, provision immediately
    if (!dev || !dev.apiKey) {
      writeLog('dev:ensure → no key; provisioning');
      await (async () => ipcMain.handlers?.['dev:provision']?.({}, {}))?.();
      dev = loadDev();
    }
    if (!dev || !dev.apiKey) return dev;
    // Validate current key with a lightweight call; retry logic will self-provision on 401 inside fetchWithApiKeyRetry
    try {
      const url = new URL('/v1/channels/list', b).toString();
      const res = await fetchWithApiKeyRetry(url, { cache: 'no-store' }, dev);
      if (res.status === 401) {
        writeLog('dev:ensure → key invalid after retry; provisioning fresh');
        await (async () => ipcMain.handlers?.['dev:provision']?.({}, {}))?.();
        dev = loadDev();
      }
    } catch (e) {
      writeLog('dev:ensure validate error: ' + String(e));
    }
    return dev;
  } catch (e) {
    writeLog('dev:ensure fatal: ' + String(e));
    return loadDev();
  }
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
  mainWindow.webContents.openDevTools();
}

async function createVerifyWindow() {
  const assetBase = app.isPackaged ? process.resourcesPath : __dirname;
  let appIconPath = path.join(assetBase, 'build', 'icon.icns');
  try { if (!fs.existsSync(appIconPath)) appIconPath = path.join(assetBase, 'routed_icon.png'); } catch { appIconPath = path.join(assetBase, 'routed_icon.png'); }
  verifyWindow = new BrowserWindow({
    width: 420,
    height: 460,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Routed — Verify',
    icon: appIconPath,
    show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  await verifyWindow.loadFile('verify.html');
  verifyWindow.on('closed', () => { verifyWindow = null; });
  writeLog('Verify window created');
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
    { label: 'Toggle DevTools', click: () => { try { if (mainWindow && mainWindow.webContents) { if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools(); else mainWindow.webContents.openDevTools({ mode: 'detach' }); } } catch (e) { writeLog('tray:toggleDevTools error ' + String(e)); } } },
    { label: 'Quit Routed', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Routed');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

async function runSelfDiagnostics() {
  try {
    writeLog('diag: starting');
    // Basic environment
    try { writeLog(`diag: platform=${process.platform} arch=${process.arch} node=${process.version}`); } catch {}
    try { writeLog(`diag: electron=${(process.versions && process.versions.electron) || 'unknown'}`); } catch {}

    // Base URL health
    const b = baseUrl();
    writeLog(`diag: base_url=${b}`);
    try {
      const url = new URL('/v1/health/deep', b).toString();
      const { signal, cancel } = withTimeoutSignal(5000);
      const res = await fetch(url, { cache: 'no-store', signal }).catch((e) => { throw e; });
      const txt = await res.text().catch(() => '');
      cancel();
      writeLog(`diag: health_deep status=${res.status} body=${txt.slice(0,200)}`);
    } catch (e) { writeLog('diag: health_deep error ' + String(e)); }

    // Developer key presence and validity
    let dev = null; try { dev = loadDev(); } catch {}
    const hasKey = !!(dev && dev.apiKey);
    writeLog(`diag: dev_key_present=${hasKey}`);
    if (hasKey) {
      try {
        const url = new URL('/v1/channels/list', b).toString();
        const { signal, cancel } = withTimeoutSignal(5000);
        const res = await fetchWithApiKeyRetry(url, { cache: 'no-store', signal }, dev);
        const txt = await res.text().catch(() => '');
        cancel();
        writeLog(`diag: channels_list status=${res.status} body=${txt.slice(0,200)}`);
      } catch (e) { writeLog('diag: channels_list error ' + String(e)); }
    }

    // Deno presence for scripts runner
    try {
      const p = (scriptsOrch && scriptsOrch._denoPath && scriptsOrch._denoPath()) || null;
      writeLog(`diag: deno_present=${!!p} path=${p || 'null'}`);
    } catch (e) { writeLog('diag: deno check error ' + String(e)); }

    // OpenAI key presence (do NOT log value)
    try {
      const fileKey = tryReadUserOpenAIKey();
      const hasOpenAI = !!fileKey; // We do not consider env as a valid source for generation
      writeLog(`diag: openai_key_present=${hasOpenAI} (source=${fileKey ? 'userData' : 'none'})`);
      if (process.env.OPENAI_BASE_URL) writeLog(`diag: openai_base_url=${process.env.OPENAI_BASE_URL}`);
    } catch {}

    writeLog('diag: done');
  } catch (e) {
    writeLog('diag: fatal error ' + String(e));
  }
}

function buildAppMenu() {
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
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          ...(isMac ? [{ role: 'pasteAndMatchStyle' }] : []),
          { role: 'delete' },
          { role: 'selectAll' },
          ...(isMac ? [
            { type: 'separator' },
            { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
          ] : [])
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Toggle Developer Tools', accelerator: isMac ? 'Command+Alt+I' : 'Ctrl+Alt+I', click: () => { try { if (!mainWindow) return; if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools(); else mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch (e) { writeLog('menu:toggleDevTools error ' + String(e)); } } },
        ],
      },
      {
        label: 'Window',
        role: 'windowMenu',
      },
      {
        label: 'Developer',
        submenu: [
          { 
            label: 'Open Dev Tools',
            accelerator: 'CmdOrCtrl+Shift+I',
            click() { mainWindow.webContents.openDevTools(); }
          }
        ]
      }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch {}
}

async function postInitIfNeeded() {
  if (_postInitDone) return;
  try {
    const d = loadDev();
    const verified = !!(d && d.verifiedUserId && d.verifiedPhone);
    if (!verified) { writeLog('post-init: awaiting phone verification'); return; }
  } catch {}
  try { createTray(); } catch {}
  try { buildAppMenu(); } catch {}
  try { setTimeout(() => { runSelfDiagnostics().catch(() => {}); }, 0); } catch {}
  _postInitDone = true;
  writeLog('post-init: completed');
}

if (!process.env.TEST_MODE && !process.env.VITEST) app.whenReady().then(async () => {
  try { app.setName('Routed'); } catch {}
  // Optionally clear all local state before creating any windows
  if (CLEAN_START) {
    writeLog('App starting with --clean-start');
    await cleanLocalState();
  }
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
    // DevTools global shortcut
    const combo = process.platform === 'darwin' ? 'Command+Alt+I' : 'Ctrl+Alt+I';
    try { globalShortcut.register(combo, () => { try { if (mainWindow && mainWindow.webContents) { if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools(); else mainWindow.webContents.openDevTools({ mode: 'detach' }); } } catch (e) { writeLog('shortcut:toggleDevTools error ' + String(e)); } }); } catch (e) { writeLog('shortcut register error ' + String(e)); }
  } catch {}

  // Preflight with no window: health -> (optional) key -> verified?
  try {
    // Health
    const b = baseUrl();
    try {
      const url = new URL('/v1/health/deep', b).toString();
      const { signal, cancel } = withTimeoutSignal(3000);
      const res = await fetch(url, { cache: 'no-store', signal });
      const txt = await res.text().catch(() => '');
      cancel();
      writeLog(`preflight: health_deep status=${res.status} body=${txt.slice(0,120)}`);
    } catch (e) { writeLog('preflight: health error ' + String(e)); }

    // Schema check to proactively surface DB mismatches
    try {
      const url = new URL('/v1/health/schema', b).toString();
      const { signal, cancel } = withTimeoutSignal(3000);
      const res = await fetch(url, { cache: 'no-store', signal });
      const txt = await res.text().catch(() => '');
      cancel();
      writeLog(`preflight: health_schema status=${res.status} body=${txt.slice(0,200)}`);
    } catch (e) { writeLog('preflight: schema error ' + String(e)); }

    // Verified?
    let verified = false; let dev = null;
    try { 
      dev = loadDev(); 
      verified = !!(dev && dev.verifiedUserId && dev.verifiedPhone); 
      writeLog(`preflight: phone verified=${!!(dev && dev.verifiedPhone)}, developer id exists=${!!(dev && dev.apiKey)}, devId exists=${!!(dev && dev.devId)}`);
    } catch {}

    if (verified && dev && dev.devId) {
      // Ensure developer identity before showing window (provision if missing/invalid)
      try {
        const ensuredDev = await ensureValidDeveloper();
        if (ensuredDev && ensuredDev.apiKey) { writeLog('preflight: developer ensured'); notifyDevUpdated(ensuredDev); }
      } catch (e) { writeLog('preflight: ensure developer error ' + String(e)); }
      // Attempt to ensure OpenAI key (best-effort)
      try { const ensured = await ensureOpenAIKeyFromServer(); writeLog('preflight: openai ' + (ensured && ensured.ok ? 'ok' : 'skip')); } catch {}
      await createWindow();
      writeLog('App ready (verified)');
      await postInitIfNeeded();
    } else {
      await createVerifyWindow();
      writeLog('App ready (verify-first)');
    }
  } catch (e) {
    writeLog('preflight fatal: ' + String(e));
    // As a fallback, show verify window to allow recovery
    try { await createVerifyWindow(); } catch {}
  }
});

if (!process.env.TEST_MODE && !process.env.VITEST) {
  app.on('window-all-closed', () => {
    // Keep app running in tray on macOS
    if (process.platform !== 'darwin') app.quit();
    writeLog('All windows closed');
  });

  app.on('activate', () => {
    try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } catch {}
    writeLog('App activated');
  });

  app.on('before-quit', () => { isQuitting = true; try { tray?.destroy?.(); } catch {} });
}

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

ipcMain.handle('resolve-channel', async (_evt, id, resolveBaseUrl) => {
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

// App log helpers
ipcMain.handle('app:logs:path', async () => {
  try {
    const p = resolveLogPath();
    let exists = false; let size = 0;
    try { const st = fs.statSync(p); exists = !!st; size = st.size || 0; } catch {}
    return { ok: true, path: p, exists, size };
  } catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle('app:logs:poke', async () => {
  try { writeLog('poke: app log test line'); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
});
// Read app log content with optional maxChars limit
ipcMain.handle('app:logs:read', async (_evt, opts) => {
  try {
    const p = resolveLogPath();
    let content = '';
    try { content = fs.readFileSync(p, 'utf8'); } catch {}
    const max = opts && Number(opts.maxChars) > 0 ? Number(opts.maxChars) : 40000;
    if (content && content.length > max) {
      content = content.slice(-max);
    }
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Quit + Version APIs
ipcMain.on('app:quit', () => { isQuitting = true; try { app.quit(); } catch {} });
ipcMain.handle('app:version', async () => {
  try { return app.getVersion ? app.getVersion() : '0.0.0'; } catch { return '0.0.0'; }
});

// DevTools toggle
ipcMain.handle('devtools:toggle', async () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
      else mainWindow.webContents.openDevTools({ mode: 'detach' });
      return { ok: true };
    }
  } catch (e) {
    writeLog('devtools:toggle error: ' + String(e));
  }
  return { ok: false };
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

// Scripts Orchestrator (scaffold)
class ScriptsOrchestrator {
  constructor(baseDirResolver) {
    this._resolveBase = baseDirResolver;
    this._scriptsRoot = null;
    this._registry = { scripts: [] };
    this._loaded = false;
    this._timers = new Map(); // id -> NodeJS.Timer
    this._procs = new Map();  // id -> child process
  }
  scriptsRoot() {
    if (!this._scriptsRoot) {
      try { this._scriptsRoot = path.join(app.getPath('userData'), 'scripts'); } catch { this._scriptsRoot = path.join(process.cwd(), 'scripts'); }
      try { fs.mkdirSync(this._scriptsRoot, { recursive: true }); } catch {}
    }
    return this._scriptsRoot;
  }
  registryPath() { return path.join(this.scriptsRoot(), 'scripts.json'); }
  loadRegistry() {
    if (this._loaded) return;
    try { this._registry = JSON.parse(fs.readFileSync(this.registryPath(), 'utf8')); } catch { this._registry = { scripts: [] }; }
    this._loaded = true;
  }
  saveRegistry() { try { fs.writeFileSync(this.registryPath(), JSON.stringify(this._registry, null, 2)); } catch {}
  }
  list() { this.loadRegistry(); return this._registry.scripts || []; }
  get(id) {
    this.loadRegistry();
    const meta = (this._registry.scripts || []).find(s => s.id === id) || null;
    if (!meta) return null;
    const dir = path.join(this.scriptsRoot(), id);
    let manifest = null; let code = '';
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch {}
    try { code = fs.readFileSync(path.join(dir, 'script.ts'), 'utf8'); } catch {}
    return { ...(meta||{}), manifest, __code: code };
  }
  _slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64) || 'script'; }
  _newId(base) {
    const ts = Date.now().toString(36);
    let id = `${base}-${ts}`;
    if (this.get(id)) id = `${base}-${ts}-${Math.floor(Math.random()*1e4)}`;
    return id;
  }
  create({ name, mode, topic }) {
    this.loadRegistry();
    const base = this._slug(name || 'script');
    const id = this._newId(base);
    const dir = path.join(this.scriptsRoot(), id);
    try { fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.join(dir, 'logs'), { recursive: true }); fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); } catch {}
    const manifest = {
      id, name: name || id, mode: mode || 'poller', enabled: false,
      defaultTopic: topic || 'runs.finished', schedule: { type: 'interval', everyMinutes: 5 },
      runtime: { port: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    const entry = mode === 'webhook' ?
`// ${id} - webhook template\nexport async function onRequest(req, ctx) {\n  const body = await req.json().catch(() => ({}));\n  await ctx.notify({ title: 'Webhook', body: JSON.stringify(body).slice(0, 200) });\n  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });\n}\n` :
`// ${id} - poller template\nexport async function handler(ctx) {\n  const res = await fetch('https://example.com', { method: 'GET' });\n  await ctx.notify({ title: 'Poller', body: 'Status ' + res.status });\n}\n`;
    try { fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2)); } catch {}
    try { fs.writeFileSync(path.join(dir, 'script.ts'), entry); } catch {}
    this._registry.scripts = [...(this._registry.scripts||[]), { id, name: manifest.name, mode: manifest.mode, enabled: false, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt }];
    this.saveRegistry();
    return { id, dir };
  }
  update(id, { name, mode, code, manifest }) {
    this.loadRegistry();
    const dir = path.join(this.scriptsRoot(), id);
    const metaIdx = (this._registry.scripts||[]).findIndex(s => s.id === id);
    if (metaIdx < 0) return { ok: false, error: 'not_found' };
    if (name) this._registry.scripts[metaIdx].name = name;
    if (mode) this._registry.scripts[metaIdx].mode = mode;
    this._registry.scripts[metaIdx].updatedAt = new Date().toISOString();
    try {
      if (code != null) fs.writeFileSync(path.join(dir, 'script.ts'), String(code));
      if (manifest) {
        const existing = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        const merged = { ...existing, ...manifest, updatedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(merged, null, 2));
      }
      this.saveRegistry();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  _denoPath() {
    // Resolve bundled deno binary (macOS now, cross-platform later)
    const resBase = app.isPackaged ? process.resourcesPath : path.join(__dirname);
    const binDir = path.join(resBase, 'resources', 'bin');
    const arch = process.arch; // 'arm64' or 'x64'
    const platform = process.platform; // 'darwin'|'win32'|'linux'
    let p;
    if (platform === 'darwin') {
      p = path.join(binDir, arch === 'arm64' ? 'deno-darwin-arm64' : 'deno-darwin-x64');
    } else if (platform === 'win32') {
      p = path.join(binDir, 'deno.exe');
    } else {
      p = path.join(binDir, 'deno-linux');
    }
    try { if (fs.existsSync(p)) return p; } catch {}
    return null; // not found; caller should handle
  }
  _runnerEntry() {
    const resBase = app.isPackaged ? process.resourcesPath : path.join(__dirname);
    return path.join(resBase, 'resources', 'runner', 'runner_shim.ts');
  }
  async _allocPort() {
    return await new Promise((resolve) => {
      const net = require('net');
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        try { srv.close(); } catch {}
        resolve(port);
      });
    });
  }
  _writeRuntimeConfig(id) {
    const dir = path.join(this.scriptsRoot(), id);
    const d = (() => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'dev.json'), 'utf8')); } catch { return null; } })();
    const cfgDir = path.join(dir, '.runner');
    try { fs.mkdirSync(cfgDir, { recursive: true }); } catch {}
    const cfg = {
      scriptId: id,
      hubBaseUrl: (d && d.hubUrl) || process.env.HUB_URL || process.env.BASE_URL || 'https://routed.onrender.com',
      apiKey: d && d.apiKey ? d.apiKey : null,
      defaultTopic: 'runs.finished',
      dataDir: path.join(dir, 'data'),
      logLevel: 'info',
      port: null,
    };
    try { fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify(cfg, null, 2)); } catch {}
    return { cfgPath: path.join(cfgDir, 'config.json'), dir };
  }
  async test(id) {
    const meta = this.get(id);
    if (!meta) return { ok: false, error: 'not_found' };
    const deno = this._denoPath();
    if (!deno) return { ok: false, error: 'deno_missing', hint: 'Place deno binary under receiver-app/resources/bin (deno-darwin-arm64 or deno-darwin-x64) and rebuild.' };
    const entry = this._runnerEntry();
    const { cfgPath, dir } = this._writeRuntimeConfig(id);
    const args = [
      'run',
      '--quiet',
      '--allow-net',
      `--allow-read=${dir}`,
      `--allow-write=${dir}`,
      entry,
      '--config', cfgPath,
      '--entry', path.join(dir, 'script.ts'),
      '--mode', 'poller',
      '--oneshot'
    ];
    const { spawn } = require('child_process');
    return await new Promise((resolve) => {
      let out = '';
      let err = '';
      let code = null;
      let proc;
      try { proc = spawn(deno, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, error: String(e) }); }
      proc.stdout.on('data', (b) => { out += b.toString(); });
      proc.stderr.on('data', (b) => { err += b.toString(); });
      proc.on('close', (c) => { code = c; resolve({ ok: c === 0, code: c, stdout: out, stderr: err }); });
    });
  }
  async runNow(id) {
    const meta = this.get(id);
    if (!meta) return { ok: false, error: 'not_found' };
    const deno = this._denoPath();
    if (!deno) return { ok: false, error: 'deno_missing' };
    const entry = this._runnerEntry();
    const { cfgPath, dir } = this._writeRuntimeConfig(id);
    const args = [
      'run',
      '--quiet',
      '--allow-net',
      `--allow-read=${dir}`,
      `--allow-write=${dir}`,
      entry,
      '--config', cfgPath,
      '--entry', path.join(dir, 'script.ts'),
      '--mode', 'poller',
      '--oneshot'
    ];
    const { spawn } = require('child_process');
    return await new Promise((resolve) => {
      let out = '';
      let err = '';
      let code = null;
      let proc;
      try { proc = spawn(deno, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, error: String(e) }); }
      proc.stdout.on('data', (b) => { out += b.toString(); });
      proc.stderr.on('data', (b) => { err += b.toString(); });
      proc.on('close', (c) => { code = c; resolve({ ok: c === 0, code: c, stdout: out, stderr: err }); });
    });
  }
  async _startWebhook(id) {
    const deno = this._denoPath();
    if (!deno) return { ok: false, error: 'deno_missing' };
    const dir = path.join(this.scriptsRoot(), id);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return { ok: false, error: 'manifest_missing' }; }
    if (!manifest.runtime) manifest.runtime = {};
    if (!manifest.runtime.port) {
      manifest.runtime.port = await this._allocPort();
      try { fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2)); } catch {}
    }
    const entry = this._runnerEntry();
    const { cfgPath } = this._writeRuntimeConfig(id);
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      cfg.port = manifest.runtime.port;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    } catch {}
    const args = [
      'run',
      '--quiet',
      '--allow-net',
      `--allow-read=${dir}`,
      `--allow-write=${dir}`,
      entry,
      '--config', cfgPath,
      '--entry', path.join(dir, 'script.ts'),
      '--mode', 'webhook'
    ];
    const { spawn } = require('child_process');
    try {
      const proc = spawn(deno, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this._procs.set(id, proc);
      proc.on('close', (code) => { this._procs.delete(id); });
      return { ok: true, port: manifest.runtime.port };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  async enableToggle(id, enabled) {
    this.loadRegistry();
    const metaIdx = (this._registry.scripts || []).findIndex(s => s.id === id);
    if (metaIdx < 0) return { ok: false, error: 'not_found' };
    const dir = path.join(this.scriptsRoot(), id);
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch {}
    if (!manifest) return { ok: false, error: 'manifest_missing' };
    manifest.enabled = !!enabled;
    try { fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2)); } catch {}
    this._registry.scripts[metaIdx].updatedAt = new Date().toISOString();
    this._registry.scripts[metaIdx].enabled = !!enabled;
    this.saveRegistry();
    // Cleanup prior
    const t = this._timers.get(id); if (t) { clearInterval(t); this._timers.delete(id); }
    const p = this._procs.get(id); if (p) { try { p.kill(); } catch {} this._procs.delete(id); }
    if (!enabled) return { ok: true };
    if (manifest.mode === 'webhook') {
      return await this._startWebhook(id);
    } else {
      // poller
      const everyMin = (manifest.schedule && (manifest.schedule.everyMinutes || manifest.schedule.everyMs/60000)) || 5;
      const ms = manifest.schedule && manifest.schedule.everyMs ? Number(manifest.schedule.everyMs) : Number(everyMin) * 60 * 1000;
      const timer = setInterval(() => { this.runNow(id).catch(()=>{}); }, ms);
      this._timers.set(id, timer);
      // fire once now
      this.runNow(id).catch(()=>{});
      return { ok: true, intervalMs: ms };
    }
  }
  webhookUrl(id) {
    try {
      const dir = path.join(this.scriptsRoot(), id);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const port = manifest && manifest.runtime && manifest.runtime.port;
      if (!port) return null;
      return `http://127.0.0.1:${port}/`;
    } catch { return null; }
  }
}
const scriptsOrch = new ScriptsOrchestrator(() => app.getPath('userData'));

// IPC (scaffold + basic actions)
ipcMain.handle('scripts:list', async () => scriptsOrch.list());
ipcMain.handle('scripts:get', async (_evt, id) => scriptsOrch.get(id));
ipcMain.handle('scripts:create', async (_evt, payload) => scriptsOrch.create(payload));
ipcMain.handle('scripts:update', async (_evt, { id, payload }) => scriptsOrch.update(id, payload));
ipcMain.handle('scripts:delete', async () => ({ ok: false, error: 'not_implemented' }));
ipcMain.handle('scripts:enableToggle', async (_evt, { id, enabled }) => scriptsOrch.enableToggle(id, enabled));
ipcMain.handle('scripts:runNow', async (_evt, id) => scriptsOrch.runNow(id));
ipcMain.handle('scripts:test', async (_evt, id) => scriptsOrch.test(id));
ipcMain.handle('scripts:logs:tail', async () => ({ ok: false, error: 'not_implemented' }));
ipcMain.handle('scripts:logs:read', async (_evt, id) => { try { return { ok: true, logs: fs.readFileSync(path.join(scriptsOrch.scriptsRoot(), id, 'logs', 'current.log'), 'utf8') }; } catch { return { ok: true, logs: '' }; } });
ipcMain.handle('scripts:logs:clear', async (_evt, id) => { try { fs.writeFileSync(path.join(scriptsOrch.scriptsRoot(), id, 'logs', 'current.log'), ''); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; } });
ipcMain.handle('scripts:webhook:url', async (_evt, id) => scriptsOrch.webhookUrl(id));
// Helper exported for testing: extract code block from LLM content
let extractCodeFromLLM;
try {
  const modPath = path.join(__dirname, 'utils', 'llm.js');
  ({ extractCodeFromLLM } = require(modPath));
} catch (e) {
  extractCodeFromLLM = function(c) {
    const m = String(c || '').match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    return (m && m[1]) ? m[1] : String(c || '');
  };
}
function extractCodeFromLLMContent(content) {
  const m = String(content || '').match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (m && m[1]) ? m[1] : String(content || '');
}

ipcMain.handle('scripts:ai:generate', async (_evt, { mode, prompt, currentCode, topic, contextData }) => {
  try {
    // STOP using env; always source key from server (persisted under userData) per product requirement
    let keySource = 'userData';
    let OPENAI_API_KEY = tryReadUserOpenAIKey();
    if (!OPENAI_API_KEY) {
      writeLog('ai:generate → no local key; requesting from server (no placeholders, no fallbacks)');
      const ensured = await ensureOpenAIKeyFromServer();
      if (!ensured.ok || !ensured.key) {
        writeLog('ai:generate → missing_openai_key_server');
        return { ok: false, error: 'missing_openai_key_server', hint: 'Server did not provide an OpenAI key for this user. Ensure the phone verification flow provisions a key in the backend.' };
      }
      OPENAI_API_KEY = ensured.key;
      keySource = ensured.source || 'server';
    }
    const safeMode = (mode === 'webhook') ? 'webhook' : 'poller';
    const t = (topic && String(topic).trim()) || 'runs.finished';

    // Load prompt guides (best-effort)
    let guide = '';
    let devGuide = '';
    try {
      const resBase = app.isPackaged ? process.resourcesPath : __dirname;
      const p1 = path.join(resBase, 'resources', 'ai', 'prompt_guides.md');
      const p2 = path.join(resBase, 'resources', 'ai', 'dev_api_guide.md');
      try { guide = fs.readFileSync(p1, 'utf8'); } catch {}
      try { devGuide = fs.readFileSync(p2, 'utf8'); } catch {}
    } catch {}

    // Build structured output schema for Responses API
    const jsonSchema = {
      name: 'routed_script_generation',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'manifestDelta'],
        properties: {
          code: { type: 'string', description: 'Complete TypeScript source for a single-file Deno script.' },
          manifestDelta: {
            type: 'object',
            description: 'Manifest changes to apply to the script.',
            additionalProperties: false,
            properties: {
              defaultTopic: { type: 'string', description: 'Default notification topic to use if not overridden.' }
            },
            required: ['defaultTopic']
          }
        }
      }
    };

    // Compose instructions and input with an example JSON
    const exampleJson = JSON.stringify({
      code: 'export async function handler(ctx){ /* ... */ }',
      manifestDelta: { defaultTopic: t },
      summary: 'Polls an endpoint and notifies on changes.',
      warnings: []
    }, null, 2);

    const system = [
      'You are GPT-5 generating a single-file TypeScript script for Deno.',
      'Target: Electron-bundled Deno runner providing ctx.notify({ title, body, payload?, topic? }).',
      'Constraints:',
      '- No external npm imports; use built-ins (fetch, URL, crypto).',
      '- Do not access environment variables; use ctx and file-local state only.',
      '- For poller mode: export async function handler(ctx).',
      '- For webhook mode: export async function onRequest(req, ctx) returning Response.',
      'Quality: concise, robust, handle errors, reasonable timeouts.',
      '',
      'Output strictly as JSON matching the provided schema. No prose outside JSON.'
    ].join('\n');

    const dev = (function(){ try { return loadDev(); } catch { return null; } })();
    const safetyId = (dev && (dev.userId || dev.verifiedUserId || dev.tenantId)) ? `dev:${dev.userId || dev.verifiedUserId || dev.tenantId}` : 'dev:unknown';

    const inputText = [
      '# SDK and Guardrails',
      guide || '(no guide available)',
      '',
      '<<<ROUTED_API_GUIDE_START>>>',
      devGuide || '(no developer API guide available)',
      '<<<ROUTED_API_GUIDE_END>>>',
      '',
      '# Mode',
      `mode: ${safeMode}`,
      '',
      '# Default Topic',
      `defaultTopic: ${t}`,
      '',
      '# Current Script (for rewrite, optional)',
      currentCode ? '```ts\n' + String(currentCode).slice(0, 20000) + '\n```' : '(none)',
      '',
      '# Freeform Context (optional)',
      contextData ? String(contextData).slice(0, 40000) : '(none)',
      '',
      '# Intent',
      String(prompt || '(no prompt provided)'),
      '',
      '# JSON Output Example (conform to schema)',
      '```json',
      exampleJson,
      '```'
    ].join('\n');

    const body = {
      model: 'gpt-5',
      instructions: system,
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: inputText }] }
      ],
      text: {
        format: { type: 'json_schema', name: jsonSchema.name, schema: jsonSchema.schema }
      },
      // Defaults for reasoning/temperature/etc are used intentionally per requirements
      safety_identifier: safetyId,
      store: false
    };

    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    };
    if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT;
    if (process.env.OPENAI_ORG) headers['OpenAI-Organization'] = process.env.OPENAI_ORG;

    // Debug log (redacted) to help diagnose without leaking secrets
    try {
      const tail = String(OPENAI_API_KEY).slice(-6);
      writeLog(`ai:generate → calling ${base}/v1/responses model=gpt-5 key_source=${keySource} auth_tail=${tail} safety_id=${safetyId}`);
    } catch {}

    const resp = await fetch(`${base}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
      writeLog(`ai:generate http_error status=${resp.status} body=${raw.slice(0,400)}`);
      return { ok: false, error: `openai_error_${resp.status}`, detail: raw.slice(0, 4000) };
    }

    // Parse Responses API result and extract output_text
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    // Aggregate all output_text parts into one string
    const outputItems = data && Array.isArray(data.output) ? data.output : [];
    let outputText = '';
    for (const item of outputItems) {
      const parts = item && Array.isArray(item.content) ? item.content : [];
      for (const p of parts) {
        if (p && p.type === 'output_text' && typeof p.text === 'string') {
          outputText += p.text;
        }
      }
    }

    if (!outputText) {
      writeLog('ai:generate empty_output_text body_snippet=' + raw.slice(0, 800));
      return { ok: false, error: 'empty_output_from_model', detail: raw.slice(0, 1200) };
    }

    // Expect structured JSON per schema
    let parsed;
    try { parsed = JSON.parse(outputText); } catch (e) {
      writeLog('ai:generate parse_json_failed snippet=' + String(outputText).slice(0, 400));
      // Fallback: try to extract code fence if model misbehaves
      const code = extractCodeFromLLMContent(outputText);
      return { ok: true, code, manifestDelta: { defaultTopic: t } };
    }

    const code = String(parsed.code || '');
    const manifestDelta = parsed.manifestDelta && typeof parsed.manifestDelta === 'object' ? parsed.manifestDelta : { defaultTopic: t };
    if (!code) {
      writeLog('ai:generate schema_missing_code');
      return { ok: false, error: 'schema_missing_code' };
    }

    return { ok: true, code, manifestDelta };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Developer/Channels IPC

// Verification IPC
ipcMain.handle('verify:start', async (_evt, { phone, country }) => {
  try {
    const res = await fetch(new URL('/v1/verify/start', baseUrl()).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, country }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`verify:start → ok for ${phone}`);
    return { ok: true };
  } catch (e) {
    writeLog('verify:start error: ' + String(e));
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('verify:check', async (_evt, { phone, code }) => {
  writeLog(`verify:check received request for phone: ${phone}, code: ${code}`);
  try {
    const res = await fetch(new URL('/v1/verify/check', baseUrl()).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
      cache: 'no-store',
    });
    const text = await res.text();
    let j = {};
    try {
      j = JSON.parse(text);
    } catch (parseErr) {
      writeLog(`verify:check parse error - raw response: ${text}`);
      throw new Error(`Parse error: ${text}`);
    }
    
    if (!res.ok || !j.ok) {
      writeLog(`verify:check backend error - status: ${res.status}, error: ${j.error}, message: ${j.message}, raw: ${text}`);
      // Return the full error details to frontend for better debugging
      return { ok: false, error: j.error || `status ${res.status}`, message: j.message, status: j.status, details: j.details };
    }
    const d = loadDev() || {};
    d.verifiedPhone = j.phone;
    d.verifiedUserId = j.userId;
    d.verifiedTenantId = j.tenantId;
    d.hubUrl = d.hubUrl || baseUrl();
    // Ensure developer identity + API key in cloud immediately after verify (with retry + detailed logs)
    try {
      const admin = isAdminMode();
      const provUrl = new URL(admin ? '/v1/admin/sandbox/provision' : '/v1/dev/sandbox/provision', baseUrl()).toString();
      if (!d.apiKey || !d.tenantId) {
        writeLog(`verify:check → provisioning developer identity url=${provUrl}`);
        const opts = { method: 'POST', cache: 'no-store', headers: admin ? { ...adminAuthHeaders(), 'Content-Type': 'application/json' } : undefined };
        async function tryProvision() {
          const pRes = await fetch(provUrl, opts);
          const raw = await pRes.text().catch(() => '');
          let p = null; try { p = JSON.parse(raw); } catch {}
          return { pRes, p, raw };
        }
        let attempt = await tryProvision();
        if (!attempt.pRes.ok || !(attempt.p && (attempt.p.apiKey || attempt.p.api_key))) {
          writeLog(`verify:check → provision attempt1 failed status=${attempt.pRes && attempt.pRes.status} body=${String(attempt.raw).slice(0,400)}`);
          // Retry once
          attempt = await tryProvision();
        }
        if (attempt.pRes.ok && attempt.p && (attempt.p.apiKey || attempt.p.api_key)) {
          const p = attempt.p;
          d.hubUrl = baseUrl();
          d.tenantId = p.tenantId || p.tenant_id || d.tenantId || null;
          d.userId = p.userId || p.user_id || d.userId || null;
          d.apiKey = p.apiKey || p.api_key;
          writeLog('verify:check → developer key ensured');
        } else {
          writeLog(`verify:check → provision failed status=${attempt.pRes && attempt.pRes.status} body=${String(attempt.raw).slice(0,400)}`);
        }
      }
    } catch (e) {
      writeLog('verify:check → ensure developer failed: ' + String(e));
    }
    saveDev(d);
    // reload the dev object to ensure we have the latest data
    d = loadDev();
    // Validate or (re)provision developer key now that verification succeeded
    try { const ensured = await ensureValidDeveloper(); if (ensured && ensured.apiKey) notifyDevUpdated(ensured); } catch (e) { writeLog('verify:check → ensure dev failed ' + String(e)); }
    writeLog(`verify:check → ok user=${j.userId}`);
    try { await postInitIfNeeded(); } catch {}
    try {
      if (!mainWindow) { await createWindow(); }
      if (verifyWindow) { try { verifyWindow.close(); } catch {} verifyWindow = null; }
      try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } catch {}
    } catch (e) { writeLog('verify:check post-init window error: ' + String(e)); }
    return { ok: true, userId: j.userId, tenantId: d.verifiedTenantId, apiKey: d.apiKey || null };
  } catch (e) {
    writeLog('verify:check caught exception: ' + String(e));
    // Check if it's already a formatted error object
    if (typeof e === 'object' && e.ok === false) {
      return e;
    }
    return { ok: false, error: String(e), rawError: e.message || String(e) };
  }
});
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
    async function tryProvision() {
      const res = await fetch(url, opts);
      const raw = await res.text().catch(() => '');
      let j = null; try { j = JSON.parse(raw); } catch {}
      return { res, j, raw };
    }
    let attempt = await tryProvision();
    if (!attempt.res.ok || !(attempt.j && (attempt.j.apiKey || attempt.j.api_key))) {
      writeLog(`dev:provision attempt1 failed status=${attempt.res && attempt.res.status} body=${String(attempt.raw).slice(0,400)}`);
      attempt = await tryProvision();
    }
    if (!attempt.res.ok) throw new Error(`provision failed ${attempt.res.status} ${String(attempt.raw).slice(0,400)}`);
    const j = attempt.j || {};
    const dev = { hubUrl: baseUrl(), tenantId: j.tenantId || j.tenant_id, apiKey: j.apiKey || j.api_key, userId: j.userId || j.user_id };
    saveDev(dev);
    writeLog(`provision → success tenantId=${dev.tenantId} (admin=${admin})`);
    return dev;
  } catch (e) {
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('Provision failed', String(e)); } catch {} }
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

// Simple token manager for access/refresh
const TOKEN_SERVICE = 'routed';
let _access = { token: null, exp: 0 };
let _session = { deviceId: null, refreshToken: null };
async function keychainSet(account, secret) { try { if (keytar) await keytar.setPassword(TOKEN_SERVICE, account, secret); } catch (e) { writeLog('keychain set error ' + String(e)); } }
async function keychainGet(account) { try { if (keytar) return await keytar.getPassword(TOKEN_SERVICE, account); } catch (e) { writeLog('keychain get error ' + String(e)); } return null; }
async function keychainDelete(account) { try { if (keytar) await keytar.deletePassword(TOKEN_SERVICE, account); } catch (e) { writeLog('keychain del error ' + String(e)); } }
function parseJwtExp(token) { try { const [,b,] = token.split('.'); const j = JSON.parse(Buffer.from(b,'base64').toString('utf8')); return (j.exp||0)*1000; } catch { return 0; } }
async function tmInitFromKeychain() {
  _session.deviceId = await keychainGet('deviceId');
  _session.refreshToken = await keychainGet('refreshToken');
  writeLog(`auth: init session device=${_session.deviceId? 'yes':'no'} refresh=${_session.refreshToken? 'yes':'no'}`);
}
async function tmSetSession({ deviceId, refreshToken, accessToken }) {
  _session.deviceId = deviceId || null;
  _session.refreshToken = refreshToken || null;
  await keychainSet('deviceId', deviceId || '');
  await keychainSet('refreshToken', refreshToken || '');
  if (accessToken) { _access.token = accessToken; _access.exp = parseJwtExp(accessToken); }
}
async function tmClear() {
  _session.deviceId = null; _session.refreshToken = null; _access = { token: null, exp: 0 };
  await keychainDelete('deviceId'); await keychainDelete('refreshToken');
}
async function getAccessToken() {
  const skew = 5000;
  const now = Date.now();
  if (_access.token && (_access.exp - now) > skew) return _access.token;
  if (!_session.deviceId || !_session.refreshToken) throw new Error('no_session');
  const url = new URL('/auth/refresh', baseUrl()).toString();
  writeLog('auth: refreshing access');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: _session.refreshToken, deviceId: _session.deviceId }), cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
  _session.refreshToken = j.refreshToken || _session.refreshToken;
  await keychainSet('refreshToken', _session.refreshToken);
  _access.token = j.accessToken || null; _access.exp = parseJwtExp(_access.token || '');
  return _access.token;
}

(async () => { try { await tmInitFromKeychain(); } catch {} })();

ipcMain.handle('dev:getBaseUrl', async () => {
  return baseUrl();
});

// Reset dev/app data
ipcMain.handle('dev:reset', async () => {
  try {
    try { fs.unlinkSync(storePath()); } catch {}
    try { fs.unlinkSync(devStorePath()); } catch {}
    writeLog('dev:reset → cleared store and dev store');
    return true;
  } catch (e) {
    writeLog('dev:reset error: ' + String(e));
    return false;
  }
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

// Helper to try alternate API key header shapes on 401
async function fetchWithApiKeyRetry(url, init, dev) {
  const baseHeaders = init.headers || {};
  const doFetch = async (headers) => await fetch(url, { ...init, headers });
  // First attempt: Bearer + header variants
  let res = await doFetch({ ...baseHeaders, 'Authorization': `Bearer ${dev.apiKey}`, 'X-Api-Key': dev.apiKey, 'X-API-Key': dev.apiKey });
  if (res.status !== 401) return res;
  // Second attempt: raw key in Authorization
  res = await doFetch({ ...baseHeaders, 'Authorization': dev.apiKey, 'X-Api-Key': dev.apiKey, 'X-API-Key': dev.apiKey });
  if (res.status !== 401) return res;
  // Third attempt: auto-provision a fresh developer and retry once
  try { await (async () => ipcMain.handlers?.['dev:provision']?.({}, {}))?.(); } catch {}
  let fresh = loadDev();
  if (!fresh || !fresh.apiKey) return res; // give up, return last 401
return await doFetch({ ...baseHeaders, 'Authorization': `Bearer ${fresh.apiKey}`, 'X-Api-Key': fresh.apiKey, 'X-API-Key': fresh.apiKey });
}

// Public discovery list (tenant-scoped)
ipcMain.handle('public:channels:list', async (_evt, { tenantId, phone }) => {
  try {
    const base = baseUrl();
    const url = new URL('/v1/public/channels', base);
    if (tenantId) url.searchParams.set('tenant_id', String(tenantId));
    if (phone) url.searchParams.set('phone', String(phone));
    const final = url.toString();
    const { signal, cancel } = withTimeoutSignal(5000);
    writeLog(`public:channels:list → ${final}`);
    const res = await fetch(final, { cache: 'no-store', signal });
    const j = await res.json().catch(() => ({}));
    cancel();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j.channels || [];
  } catch (e) {
    writeLog(`public:channels:list error: ${String(e)}`);
    return [];
  }
});

// Join public channel by short id
ipcMain.handle('public:channels:join', async (_evt, { shortId, phone }) => {
  try {
    if (!shortId) throw new Error('missing_short_id');
    if (!phone) throw new Error('missing_phone');
    const url = new URL(`/v1/public/channels/${encodeURIComponent(String(shortId))}/join`, baseUrl()).toString();
    writeLog(`public:channels:join → short_id=${shortId} phone=***${String(phone).slice(-4)}`);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: String(phone) }), cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j;
  } catch (e) {
    writeLog(`public:channels:join error: ${String(e)}`);
    return { ok: false, error: String(e) };
  }
});

// Leave channel (public route, works for both public/private membership)
ipcMain.handle('public:channels:leave', async (_evt, { shortId, phone }) => {
  try {
    if (!shortId) throw new Error('missing_short_id');
    if (!phone) throw new Error('missing_phone');
    const url = new URL(`/v1/public/channels/${encodeURIComponent(String(shortId))}/leave`, baseUrl()).toString();
    writeLog(`public:channels:leave → short_id=${shortId} phone=***${String(phone).slice(-4)}`);
    const res = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: String(phone) }), cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j;
  } catch (e) {
    writeLog(`public:channels:leave error: ${String(e)}`);
    return { ok: false, error: String(e) };
  }
});

// Publisher-scoped unsubscribe (requires developer key)
ipcMain.handle('channels:unsubscribe', async (_evt, { shortId, phone }) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    if (!shortId) throw new Error('missing_short_id');
    if (!phone) throw new Error('missing_phone');
    const url = new URL(`/v1/channels/${encodeURIComponent(String(shortId))}/unsubscribe`, baseUrl()).toString();
    writeLog(`channels:unsubscribe req → short_id=${shortId} phone=***${String(phone).slice(-4)}`);
    const res = await fetchWithApiKeyRetry(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: String(phone) }), cache: 'no-store' }, dev);
    const txt = await res.text().catch(() => '');
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (!res.ok) {
      writeLog(`channels:unsubscribe http_error status=${res.status} body=${txt.slice(0,400)}`);
      throw new Error((j && j.error) ? j.error : `status ${res.status}`);
    }
    writeLog('channels:unsubscribe → ok');
    return j || { ok: true };
  } catch (e) {
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('Unsubscribe failed', String(e)); } catch {} }
    writeLog(`channels:unsubscribe error: ${String(e)}`);
    return { ok: false, error: String(e) };
  }
});

// User-scoped channels (private + joined public)
ipcMain.handle('users:channels:list', async (_evt, { userId }) => {
  try {
    if (!userId) throw new Error('missing_user_id');
    const url = new URL(`/v1/users/${encodeURIComponent(String(userId))}/channels`, baseUrl()).toString();
    writeLog(`users:channels:list → ${url}`);
    const res = await fetch(url, { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    return j.channels || [];
  } catch (e) {
    writeLog(`users:channels:list error: ${String(e)}`);
    return [];
  }
});

ipcMain.handle('channels:list', async (_evt, _tenantId) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    const url = new URL('/v1/channels/list', baseUrl()).toString();
    const res = await fetchWithApiKeyRetry(url, { cache: 'no-store' }, dev);
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    const channels = j.channels || j || [];
    writeLog(`channels:list → ${Array.isArray(channels)? channels.length: 0}`);
    return { channels };
  } catch (e) {
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('List channels failed', String(e)); } catch {} }
    writeLog(`channels:list error: ${String(e)}`);
    return { channels: [] };
  }
});

ipcMain.handle('channels:create', async (_evt, { name, description, allowPublic, topicName, creatorPhone }) => {
  try {
    let dev = loadDev();
    writeLog(`channels:create:init name=${String(name||'')} allowPublic=${!!allowPublic} hasKey=${!!(dev && dev.apiKey)} hasPhone=${!!(dev && dev.verifiedPhone)}`);
    // Ensure we have a valid key for this hub (handles post-reset DB where old keys are invalid)
    try { dev = await ensureValidDeveloper(); } catch (e) { writeLog('channels:create: ensure dev error ' + String(e)); }
    if (!dev || !dev.apiKey) {
      writeLog('channels:create: provisioning developer first');
      try { await (async () => ipcMain.handlers?.['dev:provision']?.({}, {}))?.(); } catch (e) { writeLog('channels:create: provision error ' + String(e)); }
      dev = loadDev();
      writeLog(`channels:create: post-provision hasKey=${!!(dev && dev.apiKey)} tenantId=${dev && dev.tenantId ? dev.tenantId : 'null'}`);
    }
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    if (!creatorPhone && dev && dev.verifiedPhone) creatorPhone = dev.verifiedPhone;
    if (!creatorPhone) writeLog('channels:create: warning creatorPhone missing (will still create without auto-subscribe)');
    const url = new URL('/v1/channels/create', baseUrl()).toString();
    // Server expects snake_case keys
    const body = {
      name: String(name || '').trim(),
      description: (description != null && String(description).trim()) ? String(description).trim() : undefined,
      allow_public: !!allowPublic,
      topic_name: (topicName && String(topicName).trim()) || 'runs.finished',
      creator_phone: (creatorPhone && String(creatorPhone).trim()) || undefined,
    };
    writeLog(`channels:create:req url=${url} body=${JSON.stringify({ ...body, creator_phone: body.creator_phone ? '***' + String(body.creator_phone).slice(-4) : null })}`);
    const res = await fetchWithApiKeyRetry(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body), cache: 'no-store' }, dev);
    const txt = await res.text().catch(() => '');
    let j = null; try { j = JSON.parse(txt); } catch {}
    writeLog(`channels:create:res status=${res.status} ok=${res.ok} body=${txt.slice(0,400)}`);
    if (!res.ok) {
      const errMsg = (j && j.error) ? j.error : `status ${res.status}`;
      const detail = (j && (j.detail || j.hint)) ? `: ${j.detail || j.hint}` : '';
      throw new Error(errMsg + detail);
    }
    writeLog(`channels:create → ok name=${body.name} allow_public=${body.allow_public}`);
    return j || { ok: true };
  } catch (e) {
    writeLog(`channels:create error: ${String(e)}`);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('admin:channels:users', async (_evt, shortId) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    const res = await fetchWithApiKeyRetry(new URL(`/v1/channels/${encodeURIComponent(shortId)}/users`, baseUrl()).toString(), { cache: 'no-store' }, dev);
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`channels:users(${shortId}) → ${Array.isArray(j.users)? j.users.length: 0}`);
    return j.users || [];
  } catch (e) {
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('Fetch channel users failed', String(e)); } catch {} }
    writeLog(`channels:users error: ${String(e)}`);
    return [];
  }
});

ipcMain.handle('admin:users:ensure', async (_evt, { tenantId, phone, topic }) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    const url = new URL('/v1/users/ensure', baseUrl()).toString();
    const body = { phone, topic };
    writeLog(`users:ensure req → url=${url} phone=${phone} topic=${topic || 'runs.finished'}`);
    const res = await fetchWithApiKeyRetry(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body), cache: 'no-store' }, dev);
    const txt = await res.text().catch(() => '');
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (!res.ok) {
      writeLog(`users:ensure http_error status=${res.status} body=${txt.slice(0,400)}`);
      throw new Error((j && j.error) ? j.error : `status ${res.status}`);
    }
    writeLog(`users:ensure → ok phone=${phone} userId=${j && j.userId ? j.userId : 'unknown'}`);
    return j || {};
  } catch (e) {
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('Add user failed', String(e)); } catch {} }
    writeLog(`users:ensure error: ${String(e)}`);
    return null;
  }
});

// Channel subscribe by code
ipcMain.handle('dev:channels:subscribe', async (_evt, { shortId, phone }) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    if (!phone) throw new Error('missing_phone');
    const url = new URL(`/v1/channels/${encodeURIComponent(String(shortId||''))}/subscribe`, baseUrl()).toString();
    writeLog(`channels:subscribe req → short_id=${shortId} phone=${phone}`);
    const res = await fetchWithApiKeyRetry(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ phone }), cache: 'no-store' }, dev);
    const txt = await res.text().catch(() => '');
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (!res.ok || !(j && (j.ok || j.userId))) {
      writeLog(`channels:subscribe http_error status=${res.status} body=${txt.slice(0,400)}`);
      throw new Error((j && j.error) ? j.error : `status ${res.status}`);
    }
    writeLog(`channels:subscribe → ok userId=${j && j.userId ? j.userId : 'unknown'}`);
    return j || { ok: true };
  } catch (e) {
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('Join channel failed', String(e)); } catch {} }
    writeLog(`channels:subscribe error: ${String(e)}`);
    return null;
  }
});

// Auth IPC handlers
/**
 * IMPORTANT: SMS auth completion handler must be resilient to route shape differences across deployments.
 * Root cause of past failures:
 * - Some deployments expose /v1/auth/complete-sms, others expose /auth/complete-sms (unversioned).
 * - Historically we called only one path and threw on non-200, which the packaged app surfaced as a crash.
 * The fix and why to keep it:
 * - Always try /v1 first, then fallback to unversioned.
 * - Soft-fail (return { ok:false, error }) instead of throwing so the UI can proceed to ensure the user and continue via WS.
 * - This avoids brittle coupling to one route shape and prevents recurring login loops. Do not revert this pattern.
 */
ipcMain.handle('auth:completeSms', async (_evt, { phone, deviceName, wantDefaultOpenAIKey }) => {
  try {
    const b = baseUrl();
    const body = { phone, deviceName: deviceName || os.hostname?.() || 'device', wantDefaultOpenAIKey: !!wantDefaultOpenAIKey };
    async function tryPath(path) {
      const url = new URL(path, b).toString();
      writeLog(`auth:complete req → ${url} phone=${phone}`);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
      const txt = await res.text().catch(() => '');
      let j = null; try { j = JSON.parse(txt); } catch {}
      return { res, txt, j, url };
    }
    // Try versioned path first, then unversioned
    let attempt = await tryPath('/v1/auth/complete-sms');
    if (attempt.res.status === 404) attempt = await tryPath('/auth/complete-sms');
    if (!attempt.res.ok) {
      writeLog(`auth:complete http_error status=${attempt.res.status} body=${attempt.txt.slice(0,400)} url=${attempt.url}`);
      // Soft-fail: return structured result so caller can continue without session tokens
      return { ok: false, error: (attempt.j && attempt.j.error) ? attempt.j.error : `status ${attempt.res.status}` };
    }
    const j = attempt.j || {};
    try { await tmSetSession({ deviceId: j.deviceId, refreshToken: j.refreshToken, accessToken: j.accessToken }); } catch {}
    const d = loadDev() || {};
    if (j.user && j.user.devId) {
      d.devId = j.user.devId;
      saveDev(d);
    }
    // If the server returned a default OpenAI key, persist it for the main process to use
    try {
      const svKey = j.defaultOpenAIKey || j.openaiKey || j.openAIKey || null;
      if (isStructurallyValidOpenAIKey(svKey)) {
        const ok = persistUserOpenAIKey(svKey);
        if (ok && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = svKey; // best-effort for current session
        writeLog(`auth:complete → default OpenAI key ${ok ? 'stored' : 'store_failed'}`);
      } else {
        writeLog('auth:complete → server did not provide a valid default OpenAI key');
      }
    } catch (e) { writeLog('auth:complete → persist OpenAI key error ' + String(e)); }
    writeLog('auth:complete → ok');
    return { ok: true, ...j };
  } catch (e) {
    writeLog('auth:complete error: ' + String(e));
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('Login failed', String(e)); } catch {} }
    // Soft-fail so UI can proceed with WS using userId only
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('auth:logout', async () => {
  try {
    const at = await getAccessToken().catch(() => null);
    if (at) {
      const res = await fetch(new URL('/auth/logout', baseUrl()).toString(), { method: 'POST', headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${at}` }, body: JSON.stringify({ deviceId: _session.deviceId }) });
      await res.text().catch(() => '');
    }
  } catch {}
  await tmClear();
  writeLog('auth:logout → ok');
  return true;
});

ipcMain.handle('auth:logoutAll', async () => {
  try {
    const at = await getAccessToken();
    const res = await fetch(new URL('/auth/logout-all', baseUrl()).toString(), { method: 'POST', headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${at}` } });
    await res.text().catch(() => '');
  } catch {}
  await tmClear();
  writeLog('auth:logout-all → ok');
  return true;
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
const res = await fetchWithApiKeyRetry(new URL('/v1/messages', b).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, body, payload: payload ?? null }),
      cache: 'no-store',
    }, dev);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`sendMessage → ok topic=${topic} title=${title}`);
    return j;
  } catch (e) {
    if (!QUIET_ERRORS) { try { dialog.showErrorBox('Send failed', String(e)); } catch {} }
    writeLog(`sendMessage error: ${String(e)}`);
    return null;
  }
});

// Safe external URL opener (http/https only)
ipcMain.handle('app:openExternal', async (_evt, url) => {
  try {
    const u = String(url || '').trim();
    if (!u) return { ok: false, error: 'empty_url' };
    let parsed;
    try { parsed = new URL(u); } catch { return { ok: false, error: 'invalid_url' }; }
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: 'unsupported_protocol' };
    writeLog('openExternal → ' + u);
    await shell.openExternal(u).catch(() => {});
    return { ok: true };
  } catch (e) {
    writeLog('openExternal error: ' + String(e));
    return { ok: false, error: String(e) };
  }
});

ipcMain.on('app:show', () => { try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); if (process.platform === 'darwin') app.dock.show(); } } catch {} });
