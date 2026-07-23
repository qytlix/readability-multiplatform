import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronCliPath = require.resolve('electron/cli.js');
const probe = [
  "const Database = require('better-sqlite3');",
  "const database = new Database(':memory:');",
  "const row = database.prepare('SELECT 1 AS value').get();",
  'database.close();',
  "console.log(`Electron ABI ${process.versions.modules}; SQLite probe ${row.value}`);",
].join(' ');

const result = spawnSync(process.execPath, [electronCliPath, '-e', probe], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  throw new Error(`Electron native-module probe failed with exit code ${result.status ?? 'unknown'}.`);
}

process.stdout.write(result.stdout);
