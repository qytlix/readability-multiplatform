import type { FeedOperationLogger } from '../../src/main/feed/services';
import type { StructuredLogContext } from '../../src/main/logging/StructuredLogger';

export interface FeedLogRecord {
  level: 'info' | 'error';
  event: string;
  component: string;
  context?: StructuredLogContext;
}

export function createFeedLoggerSpy(): {
  logger: FeedOperationLogger;
  records: FeedLogRecord[];
} {
  const records: FeedLogRecord[] = [];
  const logger: FeedOperationLogger = {
    info: (event, component, context) => {
      records.push({ level: 'info', event, component, context });
    },
    error: (event, component, context) => {
      records.push({ level: 'error', event, component, context });
    },
  };

  return { logger, records };
}
