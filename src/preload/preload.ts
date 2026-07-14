import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type PingResponse, type ShaleAPI } from '../shared/ipc';

const ping = (): Promise<PingResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.systemPing);

const shaleAPI: ShaleAPI = {
  system: {
    ping,
  },
};

contextBridge.exposeInMainWorld('shaleAPI', shaleAPI);
