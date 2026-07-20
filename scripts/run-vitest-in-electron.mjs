import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronCliPath = require.resolve('electron/cli.js');
const vitestPackageRoot = path.dirname(require.resolve('vitest'));
const vitestCliPath = path.join(vitestPackageRoot, 'vitest.mjs');

// better-sqlite3 is loaded by both the Electron main process and integration
// tests. Running Vitest through Electron keeps one native binary and one ABI
// instead of rebuilding node_modules back and forth for Node and Electron.
const child = spawn(
  process.execPath,
  [electronCliPath, vitestCliPath, ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  },
);

child.on('error', (error) => {
  console.error('Unable to start Vitest through Electron.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
