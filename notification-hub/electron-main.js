const { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Keep references to prevent garbage collection
let mainWindow;
let tray;
let backendProcess;

// App configuration
const APP_NAME = 'Notification Hub';
const APP_VERSION = '0.1.0';
const BACKEND_PORT = 3030;

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#667eea',
    show: false
  });

  // Load the improved app with retry logic and better error handling
  mainWindow.loadFile(path.join(__dirname, 'public', 'app.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Create system tray icon
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Backend Status',
      enabled: false,
      id: 'backend-status'
    },
    { type: 'separator' },
    {
      label: 'Restart Backend',
      click: () => {
        restartBackend();
      }
    },
    {
      label: 'View Logs',
      click: () => {
        openLogsWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'About',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: 'About Notification Hub',
          message: `Notification Hub v${APP_VERSION}`,
          detail: 'A powerful notification management system with channels, scripts, and weather updates.',
          buttons: ['OK']
        });
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
  
  // Click on tray icon shows window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });
}

// Start the backend server (or connect to OnRender)
function startBackend() {
  console.log('Connecting to backend...');
  
  // In this version, we use the OnRender backend
  // No need to start a local backend server
  updateBackendStatus('Connected to OnRender');
  
  // Check backend health immediately
  checkBackendHealth();
  
  // Check periodically
  setInterval(() => {
    checkBackendHealth();
  }, 30000); // Check every 30 seconds
}

// Stop the backend server (not needed with OnRender)
function stopBackend() {
  // No local backend to stop when using OnRender
  console.log('Disconnecting from backend...');
  updateBackendStatus('Disconnected');
}

// Restart backend (reconnect to OnRender)
function restartBackend() {
  updateBackendStatus('Reconnecting...');
  checkBackendHealth();
}

// Check backend health
async function checkBackendHealth() {
  try {
    // Check OnRender backend
    const response = await fetch('https://routed.onrender.com/health');
    if (response.ok) {
      updateBackendStatus('Connected');
      return true;
    }
  } catch (error) {
    updateBackendStatus('Connection error');
  }
  return false;
}

// Update backend status in tray
function updateBackendStatus(status) {
  if (tray) {
    const contextMenu = tray.contextMenu;
    const statusItem = contextMenu.getMenuItemById('backend-status');
    if (statusItem) {
      statusItem.label = `Backend: ${status}`;
    }
  }
}

// Open logs window
function openLogsWindow() {
  const logsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Backend Logs',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  logsWindow.loadURL('data:text/html,<h1>Logs coming soon...</h1>');
}

// Create app menu
function createMenu() {
  const template = [
    {
      label: 'Notification Hub',
      submenu: [
        { label: `About ${APP_NAME}`, role: 'about' },
        { type: 'separator' },
        { label: 'Preferences...', accelerator: 'Cmd+,', enabled: false },
        { type: 'separator' },
        { label: 'Hide', role: 'hide' },
        { label: 'Hide Others', role: 'hideothers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', role: 'undo' },
        { label: 'Redo', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        { label: 'Select All', role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', role: 'reload' },
        { label: 'Force Reload', role: 'forcereload' },
        { label: 'Toggle Developer Tools', role: 'toggledevtools' },
        { type: 'separator' },
        { label: 'Actual Size', role: 'resetzoom' },
        { label: 'Zoom In', role: 'zoomin' },
        { label: 'Zoom Out', role: 'zoomout' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', role: 'minimize' },
        { label: 'Close', role: 'close' },
        { type: 'separator' },
        { label: 'Bring All to Front', role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com/your-repo/notification-hub');
          }
        },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/your-repo/notification-hub/issues');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  createTray();
  createMenu();
  startBackend();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});

// Handle IPC messages from renderer
ipcMain.handle('get-app-version', () => APP_VERSION);
ipcMain.handle('get-backend-status', async () => {
  return await checkBackendHealth();
});
ipcMain.handle('restart-backend', () => {
  restartBackend();
  return true;
});
