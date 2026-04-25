const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvAPI', {
  ensureLampa: () => ipcRenderer.invoke('lampa:ensure-running'),
  restart: () => ipcRenderer.invoke('app:restart'),
  quit: () => ipcRenderer.invoke('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  getShortcutLogFile: () => ipcRenderer.invoke('app:get-shortcut-log-file'),
  goHome: () => ipcRenderer.invoke('app:go-home'),
  viewerLogEvent: (payload) => ipcRenderer.invoke('viewer:log-event', payload),
  onAppMenuToggle: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app-menu:toggle', listener);
    return () => ipcRenderer.removeListener('app-menu:toggle', listener);
  },
});
