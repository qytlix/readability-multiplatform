import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import path from 'node:path';

const appIconBasePath = path.resolve(__dirname, 'assets/icons/shale-app-icon');
const linuxIconPath = path.resolve(__dirname, 'assets/icons/linux/shale-app-icon-512.png');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'Shale',
    // Electron Packager selects `.icns` on macOS and `.ico` on Windows.
    icon: appIconBasePath,
    // Linux window icons need a PNG outside app.asar at runtime.
    extraResource: linuxIconPath,
    // VitePlugin sets an ignore filter that only allows /.vite/ through.
    // Override it to also include node_modules for runtime dependencies
    // (better-sqlite3 native addon, jsdom, etc.) that Vite externalized.
    ignore: (file: string) => {
      if (!file) return false; // electron-packager root itself
      // Always include Vite build output (default VitePlugin behavior)
      if (file.startsWith('/.vite')) return false;
      // Include all node_modules for runtime externals (native addons + jsdom etc.)
      if (file === '/node_modules' || file.startsWith('/node_modules/')) return false;
      return true; // everything else is ignored
    },
  },
  rebuildConfig: {},
  makers: [
    // Windows: Squirrel (NSIS-like installer)
    new MakerSquirrel({
      authors: 'Shale Team',
      description: 'Shale — a cross-platform feed reader',
    }),
    // macOS: ZIP
    new MakerZIP({}, ['darwin']),
    // Linux: RPM (Fedora/RHEL)
    new MakerRpm({
      options: {
        name: 'shale',
        bin: 'Shale',
        icon: linuxIconPath,
      },
    }),
    // Linux: DEB (Debian/Ubuntu)
    new MakerDeb({
      options: {
        name: 'shale',
        bin: 'Shale',
        icon: linuxIconPath,
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Auto-unpack native .node files from ASAR so Electron can load them
    new AutoUnpackNativesPlugin({}),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      // OnlyLoadAppFromAsar blocks native modules that are unpacked from ASAR;
      // set to false because better-sqlite3 is a native addon loaded at runtime
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
