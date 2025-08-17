// Vitest global setup
import { vi } from 'vitest';

// Mock Electron to avoid side effects when requiring main.js
vi.mock('electron', () => {
  const handlers: Record<string, Function> = {};
  const ipc = {
    handle: (ch: string, fn: Function) => { handlers[ch] = fn; },
    on: () => {},
    handlers,
  };
  const mod = {
    app: {
      whenReady: async () => {},
      getPath: (_: string) => process.cwd(),
      isPackaged: false,
      on: () => {},
      getVersion: () => '0.0.0',
      setName: () => {},
      dock: { setIcon: () => {}, show: () => {} },
      setActivationPolicy: () => {},
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: () => {},
    },
    BrowserWindow: function BrowserWindow() { return { loadFile: async () => {}, on: () => {}, hide: () => {}, show: () => {}, focus: () => {} }; },
    Notification: function Notification() { return { on: () => {}, show: () => {} }; },
    dialog: { showErrorBox: () => {} },
    ipcMain: ipc,
    Tray: function Tray() { return { setToolTip: () => {}, setContextMenu: () => {}, on: () => {} }; },
    Menu: { buildFromTemplate: () => ({}) , setApplicationMenu: () => {} },
    nativeImage: { createFromPath: () => ({ getSize: () => ({ width: 18, height: 18 }), isEmpty: () => false, setTemplateImage: () => {}, resize: () => ({ getSize: () => ({ width: 18, height: 18 }) }) }) },
    globalShortcut: { register: () => {} },
    shell: { openExternal: async () => {} },
  };
  return { __esModule: true, ...mod, default: mod };
});

// Also surface a flag so app.whenReady guard can detect Vitest
// @ts-ignore
process.env.VITEST = '1';

// Also surface a flag so app.whenReady guard can detect Vitest
// @ts-ignore
process.env.VITEST = '1';

// Use modern fake timers in most tests; individual tests can switch to real timers
vi.useFakeTimers();

// Set a stable system time for deterministic logs
vi.setSystemTime(new Date('2025-08-16T12:00:00Z'));

// Provide minimal global fetch if needed by modules under test
if (typeof fetch === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeFetch = require('node-fetch');
  // @ts-ignore
  global.fetch = nodeFetch;
}

