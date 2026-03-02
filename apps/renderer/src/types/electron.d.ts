import type { ElectronAPI } from '@aim/preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
