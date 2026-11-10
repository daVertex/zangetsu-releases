const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zg', {
  win: a => ipcRenderer.send('win', a),
  pickBackground: () => ipcRenderer.invoke('pick-bg'),
  version: () => ipcRenderer.invoke('version'),
  checkUpdate: () => ipcRenderer.send('upd-check'),
  installUpdate: () => ipcRenderer.send('upd-install'),
  onUpdate: cb => ipcRenderer.on('upd', (_e, v) => cb(v)),
  onMax: cb => ipcRenderer.on('max', (_e, v) => cb(v))
});
