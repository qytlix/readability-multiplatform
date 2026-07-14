import type { ShaleAPI } from '../shared/ipc';

declare global {
  interface Window {
    shaleAPI: ShaleAPI;
  }
}

export {};
