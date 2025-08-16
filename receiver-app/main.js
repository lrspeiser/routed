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
        label: 'Window',
        role: 'windowMenu',
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

app.on('before-quit', () => { isQuitting = true; try { tray?.destroy?.(); } catch {} });

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
ipcMain.handle('scripts:ai:generate', async (_evt, { mode, prompt, currentCode, topic, contextData }) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN;
    if (!OPENAI_API_KEY) {
      return { ok: false, error: 'missing_openai_key', hint: 'Set OPENAI_API_KEY in the environment before launching the app.' };
    }
    const safeMode = (mode === 'webhook') ? 'webhook' : 'poller';
    const t = (topic && String(topic).trim()) || 'runs.finished';

    // Load prompt guide (best-effort)
    let guide = '';
    try {
      const resBase = app.isPackaged ? process.resourcesPath : __dirname;
      const p = path.join(resBase, 'resources', 'ai', 'prompt_guides.md');
      guide = fs.readFileSync(p, 'utf8');
    } catch {}

    const system = [
      'You are GPT-5 generating a single-file TypeScript script for Deno.',
      'Target: Electron-bundled Deno runner providing ctx.notify({ title, body, payload?, topic? }).',
      'Constraints:',
      '- No external npm imports; use built-ins (fetch, URL, crypto).',
      '- Do not access environment variables; use ctx and file-local state only.',
      '- For poller mode: export async function handler(ctx).',
      '- For webhook mode: export async function onRequest(req, ctx) returning Response.',
      'Quality: concise, robust, handle errors, reasonable timeouts.',
    ].join('\n');

    const user = [
      '# SDK and Guardrails',
      guide || '(no guide available)',
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
      String(prompt || '(no prompt provided)')
    ].join('\n');

    const body = {
      model: 'gpt-5',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
      max_tokens: 3000,
    };

    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    };
    if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT;
    if (process.env.OPENAI_ORG) headers['OpenAI-Organization'] = process.env.OPENAI_ORG;

    const resp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, error: `openai_error_${resp.status}`, detail: txt.slice(0, 4000) };
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';

    // Extract code block if present; else return as-is
    const code = (() => {
      const m = content.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
      return (m && m[1]) ? m[1] : content;
    })();

    return { ok: true, code, manifestDelta: { defaultTopic: t } };
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
  try {
    const res = await fetch(new URL('/v1/verify/check', baseUrl()).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    const d = loadDev() || {};
    d.verifiedPhone = j.phone;
    d.verifiedUserId = j.userId;
    d.verifiedTenantId = j.tenantId;
    saveDev(d);
    writeLog(`verify:check → ok user=${j.userId}`);
    return { ok: true, userId: j.userId };
  } catch (e) {
    writeLog('verify:check error: ' + String(e));
    return { ok: false, error: String(e) };
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

ipcMain.handle('admin:channels:list', async (_evt, _tenantId) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    const url = new URL('/v1/channels/list', baseUrl()).toString();
    const res = await fetch(url, { cache: 'no-store', headers: { 'Authorization': `Bearer ${dev.apiKey}` } });
    const j = await res.json();
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    const channels = j.channels || j;
    writeLog(`channels:list → ${Array.isArray(channels)? channels.length: 0}`);
    return channels || [];
  } catch (e) {
    dialog.showErrorBox('List channels failed', String(e));
    writeLog(`channels:list error: ${String(e)}`);
    return [];
  }
});

ipcMain.handle('admin:channels:create', async (_evt, { tenantId, name, topic }) => {
  try {
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    const url = new URL('/v1/channels/create', baseUrl()).toString();
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dev.apiKey}` };
    const body = { name, topic };
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
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
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    const res = await fetch(new URL(`/v1/channels/${encodeURIComponent(shortId)}/users`, baseUrl()).toString(), { cache: 'no-store', headers: { 'Authorization': `Bearer ${dev.apiKey}` } });
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
    const dev = loadDev();
    if (!dev || !dev.apiKey) throw new Error('Developer key not set');
    const url = new URL('/v1/users/ensure', baseUrl()).toString();
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dev.apiKey}` };
    const body = { phone, topic };
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j && j.error ? j.error : `status ${res.status}`);
    writeLog(`users:ensure → ok phone=${phone}`);
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
