import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_LOG_ERROR_CODES,
  CHAT_LOG_EVENTS,
  createChatFailureTerminal,
  logChatAttachmentOperationFailed,
  logChatRunFailed,
  logChatSessionPersistenceFailed,
} from '../../../src/main/ai/services/ChatLogging';

describe('Article Chat structured failure logging', () => {
  it('records only the first valid Chat failure terminal', () => {
    const logger = { error: vi.fn() };
    const terminal = createChatFailureTerminal();

    logChatRunFailed(logger, terminal, {
      operation: 'send',
      finalFailureStage: 'provider',
      taskRunId: 8,
      durationMs: 30,
      errorCode: 'CHAT_NETWORK_ERROR',
      success: false,
    });
    logChatSessionPersistenceFailed(logger, terminal, {
      operation: 'send',
      finalFailureStage: 'run-fail',
      taskRunId: 8,
      durationMs: 31,
      errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
      success: false,
    });

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      CHAT_LOG_EVENTS.runFailed,
      'chat.run',
      {
        operation: 'send',
        finalFailureStage: 'provider',
        taskRunId: 8,
        durationMs: 30,
        errorCode: 'CHAT_NETWORK_ERROR',
        success: false,
      },
    );
  });

  it('does not let an invalid attempt consume the terminal', () => {
    const logger = { error: vi.fn() };
    const terminal = createChatFailureTerminal();

    logChatRunFailed(logger, terminal, {
      operation: 'send',
      finalFailureStage: 'provider',
      taskRunId: 0,
      durationMs: 1,
      errorCode: 'CHAT_NETWORK_ERROR',
      success: false,
    });
    logChatSessionPersistenceFailed(logger, terminal, {
      operation: 'send',
      finalFailureStage: 'run-reserve',
      durationMs: 2,
      errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
      success: false,
    });

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toBe(
      CHAT_LOG_EVENTS.sessionPersistenceFailed,
    );
  });

  it('rebuilds each event from safe fields only', () => {
    const logger = { error: vi.fn() };
    const unsafeRun = {
      operation: 'regenerate' as const,
      finalFailureStage: 'context-preparation' as const,
      taskRunId: 9,
      durationMs: 45,
      errorCode: 'CHAT_CONTEXT_TOO_LARGE' as const,
      success: false as const,
      question: 'QUESTION_CANARY',
      prompt: 'PROMPT_CANARY',
      rawError: 'SQLITE_CANARY',
    };
    const unsafeAttachment = {
      operation: 'import' as const,
      finalFailureStage: 'file-read' as const,
      durationMs: 7,
      errorCode: CHAT_LOG_ERROR_CODES.attachmentOperationFailed,
      success: false as const,
      fileName: 'PRIVATE_FILE_CANARY',
      path: '/private/PATH_CANARY',
    };

    logChatRunFailed(
      logger,
      createChatFailureTerminal(),
      unsafeRun,
    );
    logChatAttachmentOperationFailed(
      logger,
      createChatFailureTerminal(),
      unsafeAttachment,
    );

    const serialized = JSON.stringify(logger.error.mock.calls);
    expect(serialized).not.toContain('CANARY');
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      CHAT_LOG_EVENTS.runFailed,
      'chat.run',
      {
        operation: 'regenerate',
        finalFailureStage: 'context-preparation',
        taskRunId: 9,
        durationMs: 45,
        errorCode: 'CHAT_CONTEXT_TOO_LARGE',
        success: false,
      },
    );
    expect(logger.error).toHaveBeenNthCalledWith(
      2,
      CHAT_LOG_EVENTS.attachmentOperationFailed,
      'chat.attachment',
      {
        operation: 'import',
        finalFailureStage: 'file-read',
        durationMs: 7,
        errorCode: CHAT_LOG_ERROR_CODES.attachmentOperationFailed,
        success: false,
      },
    );
  });

  it('never lets logger failures change Chat behavior', () => {
    const logger = {
      error: vi.fn(() => {
        throw new Error('logger unavailable');
      }),
    };

    expect(() => logChatSessionPersistenceFailed(
      logger,
      createChatFailureTerminal(),
      {
        operation: 'load',
        finalFailureStage: 'session-load',
        durationMs: 1,
        errorCode: CHAT_LOG_ERROR_CODES.sessionPersistenceFailed,
        success: false,
      },
    )).not.toThrow();
  });
});
