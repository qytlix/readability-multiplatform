import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type PingResponse, type ShaleAPI } from '../shared/ipc';
import { EXTERNAL_IPC_CHANNELS } from '../shared/contracts/external.ipc';

const ping = (): Promise<PingResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.systemPing);

const feedAPI = {
  add: (url: string) => ipcRenderer.invoke('feed:add', { url }),
  list: () => ipcRenderer.invoke('feed:list'),
  sync: (feedId?: number) => ipcRenderer.invoke('feed:sync', { feedId }),
  remove: (feedId: number) => ipcRenderer.invoke('feed:remove', { feedId }),
};

const entryAPI = {
  list: (params: {
    feedId?: number;
    isRead?: boolean;
    isStarred?: boolean;
    search?: string;
    limit: number;
    cursor?: { publishedAt: string; id: number };
  }) => ipcRenderer.invoke('entry:list', params),
  markRead: (ids: number[], isRead: boolean) =>
    ipcRenderer.invoke('entry:mark-read', { ids, isRead }),
  markStarred: (id: number, isStarred: boolean) =>
    ipcRenderer.invoke('entry:mark-starred', { id, isStarred }),
};

const contentAPI = {
  fetchAndClean: (entryId: number) =>
    ipcRenderer.invoke('content:fetch-and-clean', { entryId }),
  get: (entryId: number) =>
    ipcRenderer.invoke('content:get', { entryId }),
};

const externalAPI = {
  open: (request: { url: string; baseUrl?: string }) =>
    ipcRenderer.invoke(EXTERNAL_IPC_CHANNELS.open, request),
};

const shaleAPI: ShaleAPI = {
  system: {
    ping,
  },
  feed: feedAPI,
  entry: entryAPI,
  content: contentAPI,
  external: externalAPI,
};

contextBridge.exposeInMainWorld('shaleAPI', shaleAPI);
