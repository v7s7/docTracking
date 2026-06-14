const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, nativeImage } = require('electron');
const path = require('path');

// Fixed server URL — point this at the deployed docTracking web app.
// Override at install time via the DOCTRACKING_URL environment variable.
const DOCTRACKING_URL = process.env.DOCTRACKING_URL || 'http://localhost:3000';

const ICON_PATH = path.join(__dirname, 'build', 'icon.png');

let mainWindow = null;
let tray = null;

// Only one instance of the app should run per PC.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      icon: ICON_PATH,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    mainWindow.loadURL(DOCTRACKING_URL);

    // Closing the window minimizes to tray instead of quitting, so the app
    // keeps reporting presence/idle status until the user explicitly quits.
    mainWindow.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
  }

  function createTray() {
    const icon = nativeImage.createFromPath(ICON_PATH);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('docTracking');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open docTracking', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
  }

  app.whenReady().then(() => {
    createWindow();
    createTray();
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  });

  app.on('before-quit', () => { app.isQuitting = true; });

  app.on('window-all-closed', () => {
    // Keep running in the tray instead of exiting.
  });

  // Idle time (seconds since last mouse/keyboard input), used by the
  // renderer to report 'away' presence after a period of inactivity.
  ipcMain.handle('get-idle-time', () => powerMonitor.getSystemIdleTime());
}
