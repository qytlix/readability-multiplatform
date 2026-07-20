import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { FEED_IPC_CHANNELS } from '../../../src/shared/contracts/feed.ipc';
import { registerFeedIpcHandlers } from '../../../src/main/ipc/feed.handler';
import type { FeedServices } from '../../../src/main/services';

const registeredHandlers = vi.hoisted(() => new Map<string, unknown>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

type FeedSyncHandler = (
  event: IpcMainInvokeEvent,
  request: { feedId?: number },
) => Promise<unknown>;

describe('Feed sync IPC trigger mapping', () => {
  let syncFeed: ReturnType<typeof vi.fn>;
  let syncAll: ReturnType<typeof vi.fn>;
  let feedSyncHandler: FeedSyncHandler;
  let authorizedEvent: IpcMainInvokeEvent;

  beforeEach(() => {
    registeredHandlers.clear();
    syncFeed = vi.fn().mockResolvedValue({
      feed: { id: 7, feedURL: '', lastSyncStatus: 'success', syncIntervalMin: 30, createdAt: '' },
      newCount: 0,
      entries: [],
    });
    syncAll = vi.fn().mockResolvedValue([]);

    const webContents = {
      mainFrame: {},
      send: vi.fn(),
    };
    const mainWindow = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;
    authorizedEvent = {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    } as unknown as IpcMainInvokeEvent;
    const services = {
      feedService: {
        addFeed: vi.fn(),
        getFeeds: vi.fn().mockResolvedValue([]),
      },
      entryStore: {
        query: vi.fn().mockReturnValue({ entries: [] }),
      },
      syncCoordinator: {
        syncFeed,
        syncAll,
      },
    } as unknown as FeedServices;

    registerFeedIpcHandlers(() => mainWindow, services);
    feedSyncHandler = registeredHandlers.get(FEED_IPC_CHANNELS.feedSync) as FeedSyncHandler;
  });

  it('passes the internal manual trigger for a single-feed request', async () => {
    await feedSyncHandler(authorizedEvent, { feedId: 7 });

    expect(syncFeed).toHaveBeenCalledWith(7, 'manual');
  });

  it('passes the internal manual trigger for an all-feed request', async () => {
    await feedSyncHandler(authorizedEvent, {});

    expect(syncAll).toHaveBeenCalledWith('manual');
  });
});
