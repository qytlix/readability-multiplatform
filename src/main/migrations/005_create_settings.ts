/** Migration 005: Create settings table for app-wide configuration */
export const MIGRATION_005 = `
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('syncIntervalMin', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('syncMaxConcurrency', '6');
`;