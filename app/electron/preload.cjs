// Ponte mínima entre a interface e o processo principal. A interface não tem
// acesso ao Node: só a estas funções.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('discordia', {
  platform: process.platform,
  getScreenSources: (kind) => ipcRenderer.invoke('screen:sources', kind),
  selectScreenSource: (id, audio) => ipcRenderer.invoke('screen:select', id, audio),
  setTheme: (theme) => ipcRenderer.send('window:theme', theme),
  info: () => ipcRenderer.invoke('app:info'),
  setHotkeys: (list) => ipcRenderer.invoke('hotkeys:set', list),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_event, id, phase) => fn(id, phase)),
});
