import { create } from 'zustand';
import type { ToolDefinition } from '@aim/shared';

interface CatalogState {
  tools: ToolDefinition[];
  loading: boolean;
  error: string | null;
  selectedTool: ToolDefinition | null;

  // Actions
  loadTools: () => Promise<void>;
  selectTool: (toolId: string) => Promise<void>;
  clearSelection: () => void;
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  tools: [],
  loading: false,
  error: null,
  selectedTool: null,

  loadTools: async () => {
    if (!window.electronAPI) {
      set({ error: 'Electron API not available', loading: false });
      return;
    }
    set({ loading: true, error: null });
    try {
      await window.electronAPI.catalog.load();
      const tools = await window.electronAPI.catalog.listTools();
      set({ tools, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load tools',
        loading: false
      });
    }
  },

  selectTool: async (toolId: string) => {
    if (!window.electronAPI) return;
    try {
      const tool = await window.electronAPI.catalog.getTool(toolId);
      set({ selectedTool: tool });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load tool',
      });
    }
  },

  clearSelection: () => {
    set({ selectedTool: null });
  },
}));
