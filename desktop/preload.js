const { contextBridge, ipcRenderer } = require('electron');

// Exposes a minimal, read-only bridge to the renderer (the docTracking web
// app). The presence of `window.electron.isElectron` is how the React app
// detects it's running inside this desktop wrapper.
contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  // Seconds since the last mouse/keyboard input, from the OS — used to
  // report 'away' presence when the user has stepped away from the PC.
  getIdleTime: () => ipcRenderer.invoke('get-idle-time'),
});
