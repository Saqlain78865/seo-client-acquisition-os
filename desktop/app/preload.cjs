// The only bridge between the app's pages and the desktop shell: backup, restore and updates.
// Pages get these few calls, never Node or Electron themselves.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("leadliftDesktop", {
  version: () => ipcRenderer.invoke("desktop:version"),
  backup: () => ipcRenderer.invoke("desktop:backup"),
  restore: () => ipcRenderer.invoke("desktop:restore"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
});
