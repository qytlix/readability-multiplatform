export const MAIN_LIFECYCLE_EVENTS = {
  starting: 'app.lifecycle.starting',
  databaseInitializeStarted: 'database.initialize.started',
  databaseInitializeCompleted: 'database.initialize.completed',
  databaseInitializeFailed: 'database.initialize.failed',
  initializationFailed: 'app.lifecycle.initialization.failed',
  ready: 'app.lifecycle.ready',
  shutdownRequested: 'app.lifecycle.shutdown.requested',
} as const;
