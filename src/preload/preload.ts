import { contextBridge, ipcRenderer } from 'electron';

// The renderer is sandboxed: this is the only bridge to the main process.
contextBridge.exposeInMainWorld('slack', {
  platform: process.platform,
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
});
