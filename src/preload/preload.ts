import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type PingResponse, type ShaleAPI } from '../shared/ipc';
import { EXTERNAL_IPC_CHANNELS } from '../shared/contracts/external.ipc';
import { SUMMARY_IPC_CHANNELS } from '../shared/contracts/summary.ipc';
import type { SaveProviderRequest } from '../shared/contracts/provider.types';
import type { SummaryStreamEvent } from '../shared/contracts/summary.types';

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

const providerAPI = {
  get: () => ipcRenderer.invoke(SUMMARY_IPC_CHANNELS.providerGet),
  save: (request: SaveProviderRequest) =>
    ipcRenderer.invoke(SUMMARY_IPC_CHANNELS.providerSave, request),
  test: () => ipcRenderer.invoke(SUMMARY_IPC_CHANNELS.providerTest),
};

const summaryAPI = {
  get: (request: {
    entryId: number;
    targetLanguage: 'zh-CN' | 'en';
    detailLevel: 'short' | 'medium' | 'detailed';
  }) => ipcRenderer.invoke(SUMMARY_IPC_CHANNELS.summaryGet, request),
  generate: (request: {
    entryId: number;
    targetLanguage: 'zh-CN' | 'en';
    detailLevel: 'short' | 'medium' | 'detailed';
  }) => ipcRenderer.invoke(SUMMARY_IPC_CHANNELS.summaryGenerate, request),
  onEvent: (listener: (event: SummaryStreamEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: SummaryStreamEvent) => {
      listener(event);
    };
    ipcRenderer.on(SUMMARY_IPC_CHANNELS.summaryStream, handler);
    return () => ipcRenderer.removeListener(SUMMARY_IPC_CHANNELS.summaryStream, handler);
  },
};

const shaleAPI: ShaleAPI = {
  system: {
    ping,
  },
  feed: feedAPI,
  entry: entryAPI,
  content: contentAPI,
  external: externalAPI,
  provider: providerAPI,
  summary: summaryAPI,
};

contextBridge.exposeInMainWorld('shaleAPI', shaleAPI);
