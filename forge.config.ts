import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';

const appIconBasePath = path.resolve(__dirname, 'assets/icons/shale-app-icon');
const linuxIconPath = path.resolve(__dirname, 'assets/icons/linux/shale-app-icon-512.png');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // A stable reverse-DNS ID is required for a uniquely identifiable macOS bundle.
    appBundleId: 'com.github.qytlix.shale',
    // FusesPlugin modifies the arm64 Electron binary during packaging.  Tell
    // Electron Packager to perform its supported final signing pass afterwards.
    // This is an internal-test build, so use an ad-hoc identity rather than a
    // Developer ID certificate.  The options below are intentionally limited to
    // ad-hoc signing: no identity lookup, Team ID mutation, hardened runtime, or
    // timestamp service is applicable without a Developer ID certificate.
    osxSign: {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({
        hardenedRuntime: false,
        timestamp: 'none',
      }),
    },
    // Electron Packager selects `.icns` on macOS and `.ico` on Windows.
    icon: appIconBasePath,
    // Linux window icons need a PNG outside app.asar at runtime.
    extraResource: linuxIconPath,
    // The Vite plugin normally packages only `.vite`. Main-process dependencies
    // are deliberately externalized in vite.main.config.ts, so let Forge retain
    // the application dependencies and prune development-only packages.
    ignore: () => false,
  },
  // The start hook validates the actual binary before Forge reads its metadata.
  // Restrict Forge's native-module scan to our one production addon.
  rebuildConfig: {
    onlyModules: ['better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        bin: 'Shale',
        icon: linuxIconPath,
      },
    }),
    new MakerDeb({
      options: {
        bin: 'Shale',
        icon: linuxIconPath,
      },
    }),
  ],
  plugins: [
    // better-sqlite3 is a native addon and cannot be loaded from inside app.asar.
    new AutoUnpackNativesPlugin({}),
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
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
