import { describe, expect, it, vi } from 'vitest';
import {
  logChatContextCompleted,
  logChatProviderCompleted,
  logChatProviderFirstDelta,
  logChatProviderResponseHeaders,
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
    logChatContextCompleted(logger, {
      taskRunId: 7,
      durationMs: 11,
      success: true,
      contextMode: 'full',
      inputTokens: 321,
    });
    logChatProviderResponseHeaders(logger, {
      taskRunId: 7,
      durationMs: 12,
      attemptCount: 1,
    });
    logChatProviderFirstDelta(logger, {
      taskRunId: 7,
      durationMs: 18,
      attemptCount: 1,
    });
    logChatProviderCompleted(logger, {
      taskRunId: 7,
      durationMs: 4,
      attemptCount: 1,
    });
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
    expect(logger.info).toHaveBeenCalledWith(
      'chat.run.context.completed',
      'chat.run',
      {
        taskRunId: 7,
        durationMs: 11,
        success: true,
        contextMode: 'full',
        inputTokens: 321,
      },
    );
    expect(logger.info).toHaveBeenCalledWith(
      'chat.run.provider.response.headers',
      'chat.run',
      { taskRunId: 7, durationMs: 12, attemptCount: 1 },
    );
    expect(logger.info).toHaveBeenCalledWith(
      'chat.run.provider.first.delta',
      'chat.run',
      { taskRunId: 7, durationMs: 18, attemptCount: 1 },
    );
    expect(logger.info).toHaveBeenCalledWith(
      'chat.run.provider.completed',
      'chat.run',
      { taskRunId: 7, durationMs: 4, attemptCount: 1 },
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

  it('logs failed context timing without carrying unsafe source fields', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const unsafeContext = {
      taskRunId: 9,
      durationMs: 45,
      success: false as const,
      errorCode: 'CHAT_CONTEXT_TOO_LARGE' as const,
      question: 'CONTEXT_QUESTION_CANARY',
      article: 'CONTEXT_ARTICLE_CANARY',
    };

    logChatContextCompleted(logger, unsafeContext);

    expect(logger.info).toHaveBeenCalledWith(
      'chat.run.context.completed',
      'chat.run',
      {
        taskRunId: 9,
        durationMs: 45,
        success: false,
        errorCode: 'CHAT_CONTEXT_TOO_LARGE',
      },
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('CANARY');
  });
});
