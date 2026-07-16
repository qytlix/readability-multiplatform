import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type PingResponse, type ShaleAPI } from '../shared/ipc';
import {
  FEED_IPC_CHANNELS,
  type FeedSyncProgress,
} from '../shared/contracts/feed.ipc';
import { EXTERNAL_IPC_CHANNELS } from '../shared/contracts/external.ipc';
import { SUMMARY_IPC_CHANNELS } from '../shared/contracts/summary.ipc';
import type { SaveProviderRequest } from '../shared/contracts/provider.types';
import type { SummaryStreamEvent } from '../shared/contracts/summary.types';

const ping = (): Promise<PingResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.systemPing);

const feedAPI = {
  add: (url: string) => ipcRenderer.invoke(FEED_IPC_CHANNELS.feedAdd, { url }),
  list: () => ipcRenderer.invoke(FEED_IPC_CHANNELS.feedList),
  sync: (feedId?: number) =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.feedSync, { feedId }),
  remove: (feedId: number) =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.feedRemove, { feedId }),
  update: (
    feedId: number,
    params: { title?: string; siteURL?: string; syncIntervalMin?: number },
  ) => ipcRenderer.invoke(FEED_IPC_CHANNELS.feedUpdate, { feedId, params }),
  syncCancel: () => ipcRenderer.invoke(FEED_IPC_CHANNELS.feedSyncCancel, {}),
  onSyncProgress: (callback: (progress: FeedSyncProgress) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: FeedSyncProgress,
    ) => callback(progress);
    ipcRenderer.on(FEED_IPC_CHANNELS.feedSyncProgress, handler);
    return () => ipcRenderer.removeListener(FEED_IPC_CHANNELS.feedSyncProgress, handler);
  },
};

const entryAPI = {
  list: (params: {
    feedId?: number;
    isRead?: boolean;
    isStarred?: boolean;
    search?: string;
    limit: number;
    cursor?: { publishedAt: string; id: number };
  }) => ipcRenderer.invoke(FEED_IPC_CHANNELS.entryList, params),
  markRead: (ids: number[], isRead: boolean) =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.entryMarkRead, { ids, isRead }),
  markStarred: (id: number, isStarred: boolean) =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.entryMarkStarred, { id, isStarred }),
};

const contentAPI = {
  fetchAndClean: (entryId: number) =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.contentFetch, { entryId }),
  get: (entryId: number) =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.contentGet, { entryId }),
};

const dialogAPI = {
  openFile: (options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
  }) => ipcRenderer.invoke(FEED_IPC_CHANNELS.dialogOpenFile, options ?? {}),
  saveFile: (options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
  }) => ipcRenderer.invoke(FEED_IPC_CHANNELS.dialogSaveFile, options ?? {}),
};

const opmlAPI = {
  import: (filePath: string, mode: 'merge' | 'replace') =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.opmlImport, { filePath, mode }),
  export: (filePath: string) =>
    ipcRenderer.invoke(FEED_IPC_CHANNELS.opmlExport, { filePath }),
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
  opml: opmlAPI,
  dialog: dialogAPI,
  external: externalAPI,
  provider: providerAPI,
  summary: summaryAPI,
};

contextBridge.exposeInMainWorld('shaleAPI', shaleAPI);
