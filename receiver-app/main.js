const { app, BrowserWindow, Notification, dialog, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let mainWindow;
let tray;
const DEFAULT_RESOLVE_URL = 'https://routed-gbiz.onrender.com';
const storePath = () => path.join(app.getPath('userData'), 'subscriptions.json');

function loadStore() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return { subscriptions: [] }; }
}
function saveStore(data) {
  try { fs.writeFileSync(storePath(), JSON.stringify(data, null, 2)); } catch {}
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
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
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'arrow-icon-routed.png'));
  tray = new Tray(trayIcon);
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
  new Notification({ title, body }).show();
});
