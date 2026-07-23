import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifyScriptPath = path.join(projectRoot, 'scripts', 'verify-electron-native.mjs');
const electronRebuildCliPath = require.resolve('@electron/rebuild/lib/cli.js');

function runNode(entryPath, args = [], stdio = 'inherit') {
  return spawnSync(process.execPath, [entryPath, ...args], {
    cwd: projectRoot,
    stdio,
  });
}

const initialProbe = runNode(verifyScriptPath, [], 'ignore');

if (initialProbe.error) {
  console.error('Unable to run the Electron native-module probe.', initialProbe.error);
  process.exit(1);
}

if (initialProbe.status === 0) {
  process.exit(0);
}

console.warn('Electron native-module probe failed; rebuilding better-sqlite3 for Electron.');

const rebuild = runNode(electronRebuildCliPath, [
  '--force',
  '--which-module',
  'better-sqlite3',
]);

if (rebuild.error) {
  console.error('Unable to start the Electron native-module rebuild.', rebuild.error);
  process.exit(1);
}

if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1);
}

const finalProbe = runNode(verifyScriptPath);

if (finalProbe.error) {
  console.error('Unable to rerun the Electron native-module probe.', finalProbe.error);
  process.exit(1);
}

process.exit(finalProbe.status ?? 1);
