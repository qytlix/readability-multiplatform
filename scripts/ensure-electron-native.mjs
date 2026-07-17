import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runScript(scriptName, stdio = 'inherit') {
  return spawnSync(npmCommand, ['run', scriptName], {
    cwd: projectRoot,
    stdio,
  });
}

const initialProbe = runScript('verify:native', 'ignore');

if (initialProbe.status === 0) {
  process.exit(0);
}

console.warn('Electron native-module probe failed; rebuilding better-sqlite3 for Electron.');

const rebuild = runScript('rebuild:native');
if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1);
}

const finalProbe = runScript('verify:native');
process.exit(finalProbe.status ?? 1);
