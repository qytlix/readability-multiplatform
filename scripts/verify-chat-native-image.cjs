/* eslint-disable @typescript-eslint/no-var-requires -- This probe runs in Electron's CommonJS main process. */
const {
  app,
  nativeImage,
} = require('electron');

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
    + 'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const decoded = nativeImage.createFromBuffer(onePixelPng);
  if (decoded.isEmpty()) throw new Error('Electron could not decode the PNG fixture.');
  const size = decoded.getSize();
  if (size.width !== 1 || size.height !== 1) {
    throw new Error(`Unexpected decoded dimensions: ${size.width}x${size.height}`);
  }
  const normalized = decoded.toPNG();
  if (normalized.length === 0) throw new Error('Electron returned empty PNG output.');
  process.stdout.write(JSON.stringify({
    ok: true,
    width: size.width,
    height: size.height,
    normalizedBytes: normalized.length,
  }));
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
