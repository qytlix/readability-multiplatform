import { describe, expect, it, vi } from 'vitest';
import {
  logChatRunCompleted,
  logChatRunFailed,
  logChatRunRetrying,
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
    logChatRunRetrying(logger, {
      taskRunId: 7,
      attemptCount: 2,
      errorCode: 'CHAT_PROVIDER_REQUEST_FAILED',
    });
    logChatRunCompleted(logger, { taskRunId: 7, durationMs: 22 });
    const unsafeFailureContext = {
      taskRunId: 8,
      durationMs: 30,
      errorCode: 'CHAT_NETWORK_ERROR' as const,
      question: 'QUESTION_CANARY',
      selection: 'SELECTION_CANARY',
      attachmentPath: 'C:\\private\\ATTACHMENT_CANARY.png',
      apiKey: 'sk-SECRET_CANARY',
    };
    logChatRunFailed(logger, unsafeFailureContext);

    const serialized = JSON.stringify({
      info: logger.info.mock.calls,
      warn: logger.warn.mock.calls,
      error: logger.error.mock.calls,
    });
    expect(serialized).not.toContain('question');
    expect(serialized).not.toContain('article');
    expect(serialized).not.toContain('attachment');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('QUESTION_CANARY');
    expect(serialized).not.toContain('SELECTION_CANARY');
    expect(serialized).not.toContain('ATTACHMENT_CANARY');
    expect(serialized).not.toContain('SECRET_CANARY');
    expect(logger.info).toHaveBeenCalledWith(
      'chat.run.started',
      'chat.run',
      { taskRunId: 7 },
    );
    expect(logger.error).toHaveBeenCalledWith(
      'chat.run.failed',
      'chat.run',
      {
        taskRunId: 8,
        durationMs: 30,
        errorCode: 'CHAT_NETWORK_ERROR',
        success: false,
      },
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'chat.run.retrying',
      'chat.run',
      {
        taskRunId: 7,
        attemptCount: 2,
        errorCode: 'CHAT_PROVIDER_REQUEST_FAILED',
      },
    );
  });
});
