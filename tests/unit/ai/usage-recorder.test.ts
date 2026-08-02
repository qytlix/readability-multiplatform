import { describe, expect, it, vi } from 'vitest';
import { UsageRecorder } from '../../../src/main/ai/services/UsageRecorder';
import type { UsageStore } from '../../../src/main/ai/stores/UsageStore';

describe('UsageRecorder', () => {
  it('contains Store failures and emits a stable structured error', () => {
    const logger = { error: vi.fn() };
    const store = {
      createRunning: vi.fn(() => {
        throw new Error('database unavailable');
      }),
      finish: vi.fn(),
      reconcileInterruptedRunning: vi.fn(() => {
        throw new Error('database unavailable');
      }),
    } as unknown as UsageStore;
    const recorder = new UsageRecorder(store, logger);

    expect(() => recorder.start({
      providerRequestId: 5001,
      attemptId: 'attempt-5001',
      taskType: 'summary',
      taskRunId: 91,
      providerProfileId: 12,
      model: 'test-model',
      requestKind: 'summary',
    })).not.toThrow();
    expect(recorder.reconcileInterruptedRunning()).toBe(0);
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      'usage.ledger.persistence.failed',
      'usage.ledger',
      {
        taskRunId: 91,
        providerRequestId: 5001,
        stage: 'start',
        errorCode: 'USAGE_LEDGER_PERSISTENCE_FAILED',
      },
    );
    expect(logger.error).toHaveBeenNthCalledWith(
      2,
      'usage.ledger.persistence.failed',
      'usage.ledger',
      {
        stage: 'reconcile',
        errorCode: 'USAGE_LEDGER_PERSISTENCE_FAILED',
      },
    );
  });

  it('does not throw when finalizing a request cannot be persisted', () => {
    const logger = { error: vi.fn() };
    const store = {
      createRunning: vi.fn(),
      finish: vi.fn(() => {
        throw new Error('database unavailable');
      }),
      reconcileInterruptedRunning: vi.fn(() => 0),
    } as unknown as UsageStore;
    const recorder = new UsageRecorder(store, logger);
    const handle = recorder.start({
      providerRequestId: 5002,
      attemptId: 'attempt-5002',
      taskType: 'translation',
      taskRunId: 92,
      providerProfileId: 12,
      model: 'test-model',
      requestKind: 'batch',
    });

    expect(() => recorder.complete(handle, { inputTokens: 11 })).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      'usage.ledger.persistence.failed',
      'usage.ledger',
      {
        taskRunId: 92,
        providerRequestId: 5002,
        stage: 'finish',
        errorCode: 'USAGE_LEDGER_PERSISTENCE_FAILED',
      },
    );
  });

  it('does not finalize one usage request twice after Chat completion', () => {
    const store = {
      createRunning: vi.fn(),
      finish: vi.fn(),
      reconcileInterruptedRunning: vi.fn(() => 0),
    } as unknown as UsageStore;
    const recorder = new UsageRecorder(store);
    const handle = recorder.start({
      providerRequestId: 5003,
      attemptId: 'attempt-5003',
      taskType: 'chat',
      taskRunId: 93,
      providerProfileId: 12,
      model: 'test-model',
      requestKind: 'chat-answer',
    });

    recorder.complete(handle, { inputTokens: 11, outputTokens: 7 });
    recorder.fail(handle, 'CHAT_EVENT_LISTENER_FAILED', { inputTokens: 11 });

    expect(store.finish).toHaveBeenCalledOnce();
    expect(store.finish).toHaveBeenCalledWith(
      5003,
      'succeeded',
      { inputTokens: 11, outputTokens: 7 },
      undefined,
    );
  });
});
