import { create } from 'zustand';
import type { ScanReport, DetectedTool } from '@aim/shared';

interface ScannerState {
  report: ScanReport | null;
  scanning: boolean;
  error: string | null;

  // Actions
  startScan: () => Promise<void>;
  scanTool: (toolId: string) => Promise<void>;
}

export const useScannerStore = create<ScannerState>((set) => ({
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
}));
