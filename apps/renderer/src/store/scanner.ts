import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScanReport } from '@aim/shared';
import { rendererStorage } from './persist-storage';

interface ScannerState {
  report: ScanReport | null;
  scanning: boolean;
  error: string | null;

  // Actions
  startScan: () => Promise<void>;
  scanTool: (toolId: string) => Promise<void>;
  loadLastReport: () => Promise<ScanReport | null>;
}

export const useScannerStore = create<ScannerState>()(
  persist(
    (set) => ({
      report: null,
      scanning: false,
      error: null,

      startScan: async () => {
        if (!window.electronAPI) {
          set({ error: 'Electron API not available', scanning: false });
          return;
        }
        set({ scanning: true, error: null });
        try {
          const report = await window.electronAPI.scanner.start();
          set({ report, scanning: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Scan failed',
            scanning: false,
          });
        }
      },

      scanTool: async (toolId: string) => {
        if (!window.electronAPI) return;
        set({ scanning: true, error: null });
        try {
          const report = await window.electronAPI.scanner.scanTool(toolId);
          set({ report, scanning: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Scan failed',
            scanning: false,
          });
        }
      },

      loadLastReport: async () => {
        if (!window.electronAPI) {
          set({ error: 'Electron API not available' });
          return null;
        }

        try {
          const report = await window.electronAPI.scanner.getReport();
          set({ report });
          return report;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to load scan report',
          });
          return null;
        }
      },
    }),
    {
      name: 'aim.scanner.store.v1',
      storage: rendererStorage,
      partialize: (state) => ({
        report: state.report,
      }),
    }
  )
);
