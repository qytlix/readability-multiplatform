import {
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {
  extractFile,
  listPackage,
} from '@electron/asar';

const packageRoot = resolvePackageRoot(process.argv[2]);
const layout = resolvePackageLayout(packageRoot);

assertNonEmptyFile(layout.executable, 'packaged executable');
assertNonEmptyFile(layout.asarPath, 'application ASAR');
assertNonEmptyFile(
  path.join(layout.resources, 'terminology-libraries.sqlite'),
  'terminology database',
);

const archiveEntries = listPackage(layout.asarPath, { isPack: false });
const normalizedEntries = new Map(archiveEntries.map((entry) => [
  normalizeArchivePath(entry),
  entry.replace(/^[/\\]/u, ''),
]));
for (const requiredPath of [
  '.vite/build/main.js',
  '.vite/build/preload.js',
  'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
]) {
  if (!normalizedEntries.has(requiredPath)) {
    throw new Error(`Packaged runtime is missing ${requiredPath}.`);
  }
}

const mainArchivePath = normalizedEntries.get('.vite/build/main.js');
if (!mainArchivePath) throw new Error('Packaged Main bundle is unavailable.');
const mainBundle = extractFile(layout.asarPath, mainArchivePath).toString('utf8');
for (const marker of [
  'Article Chat',
  'chat-attachments',
  'CHAT_IMAGE_UNSUPPORTED',
  'CHAT_PDF_TEXT_UNAVAILABLE',
]) {
  if (!mainBundle.includes(marker)) {
    throw new Error(`Packaged Main bundle is missing the ${marker} marker.`);
  }
}

const unpackedNativeRoot = path.join(
  layout.resources,
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
);
const nativeDatabaseAddon = findFileNamed(
  unpackedNativeRoot,
  'better_sqlite3.node',
);
if (!nativeDatabaseAddon) {
  throw new Error('Packaged runtime is missing the unpacked SQLite addon.');
}
assertNonEmptyFile(nativeDatabaseAddon, 'unpacked SQLite addon');

process.stdout.write(`${JSON.stringify({
  ok: true,
  target: `${process.platform}-${process.arch}`,
  archiveEntryCount: archiveEntries.length,
  pdfRuntime: true,
  chatMainBundle: true,
  nativeDatabaseAddon: true,
})}\n`);

function resolvePackageRoot(argument) {
  if (argument) return path.resolve(argument);
  const targetName = `Shale-${process.platform}-${process.arch}`;
  const targetPath = path.resolve('out', targetName);
  if (!existsSync(targetPath)) {
    throw new Error(
      `Package ${targetName} was not found. Run npm run package first.`,
    );
  }
  return targetPath;
}

function resolvePackageLayout(root) {
  if (process.platform === 'darwin') {
    const appRoot = path.join(root, 'Shale.app', 'Contents');
    return {
      executable: path.join(appRoot, 'MacOS', 'Shale'),
      resources: path.join(appRoot, 'Resources'),
      asarPath: path.join(appRoot, 'Resources', 'app.asar'),
    };
  }
  return {
    executable: path.join(root, process.platform === 'win32'
      ? 'Shale.exe'
      : 'Shale'),
    resources: path.join(root, 'resources'),
    asarPath: path.join(root, 'resources', 'app.asar'),
  };
}

function normalizeArchivePath(value) {
  return value.replaceAll('\\', '/').replace(/^\/+/u, '');
}

function assertNonEmptyFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`The ${label} is missing.`);
  }
  if (statSync(filePath).size <= 0) {
    throw new Error(`The ${label} is empty.`);
  }
}

function findFileNamed(root, fileName) {
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return entryPath;
    if (entry.isDirectory()) {
      const nested = findFileNamed(entryPath, fileName);
      if (nested) return nested;
    }
  }
  return undefined;
}
