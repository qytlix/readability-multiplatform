import { describe, expect, it, vi } from 'vitest';
import {
  logChatRunCompleted,
  logChatRunFailed,
  logChatRunStarted,
} from '../../../src/main/ai/services/ChatLogging';

describe('Article Chat structured logging', () => {
  it('exposes only lifecycle metadata to the logger', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    logChatRunStarted(logger, 7);
    logChatRunCompleted(logger, { taskRunId: 7, durationMs: 22 });
    logChatRunFailed(logger, {
      taskRunId: 8,
      durationMs: 30,
      errorCode: 'CHAT_NETWORK_ERROR',
    });

    const serialized = JSON.stringify({
      info: logger.info.mock.calls,
      warn: logger.warn.mock.calls,
      error: logger.error.mock.calls,
    });
    expect(serialized).not.toContain('question');
    expect(serialized).not.toContain('article');
    expect(serialized).not.toContain('attachment');
    expect(serialized).not.toContain('secret');
    expect(logger.info).toHaveBeenCalledWith(
      'chat.run.started',
      'chat.run',
      { taskRunId: 7 },
    );
  });
});
