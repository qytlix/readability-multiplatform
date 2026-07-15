import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Native modules and runtime-dependent packages that Vite should not bundle.
      // jsdom reads stylesheets from its install directory at runtime,
      // so it must be loaded from node_modules, not bundled.
      external: [
        'canvas',
        'better-sqlite3',
        'jsdom',
        '@mozilla/readability',
        'turndown',
        'rss-parser',
        'dompurify',
      ],
    },
  },
});