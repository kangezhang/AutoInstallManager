import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InstallTask } from '@aim/shared';
import { rendererStorage } from './persist-storage';

interface InstallerState {
  tasks: InstallTask[];
  loading: boolean;
  error: string | null;

  // Actions
  loadTasks: () => Promise<void>;
  createTask: (toolId: string, version: string) => Promise<InstallTask>;
  startTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  rollbackTool: (toolId: string) => Promise<void>;
  uninstallTool: (toolId: string) => Promise<void>;
}

export const useInstallerStore = create<InstallerState>()(
  persist(
    (set, get) => ({
      tasks: [],
      loading: false,
      error: null,

      loadTasks: async () => {
        if (!window.electronAPI) {
          set({ error: 'Electron API not available', loading: false });
          return;
        }
        set({ loading: true, error: null });
        try {
          const tasks = await window.electronAPI.installer.listTasks();
          set({ tasks, loading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to load tasks',
            loading: false,
          });
        }
      },

      createTask: async (toolId: string, version: string) => {
        if (!window.electronAPI) throw new Error('Electron API not available');
        try {
          const task = await window.electronAPI.installer.createTask(toolId, version);
          set({ tasks: [...get().tasks, task] });
          return task;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to create task',
          });
          throw error;
        }
      },

      startTask: async (taskId: string) => {
        if (!window.electronAPI) return;
        try {
          await window.electronAPI.installer.start(taskId);
          await get().loadTasks();
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to start task',
          });
        }
      },

      cancelTask: async (taskId: string) => {
        if (!window.electronAPI) return;
        try {
          await window.electronAPI.installer.cancel(taskId);
          await get().loadTasks();
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to cancel task',
          });
        }
      },

      rollbackTool: async (toolId: string) => {
        if (!window.electronAPI) return;
        try {
          await window.electronAPI.installer.rollback(toolId);
          await get().loadTasks();
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to rollback tool',
          });
        }
      },

      uninstallTool: async (toolId: string) => {
        if (!window.electronAPI) return;
        try {
          await window.electronAPI.installer.uninstall(toolId);
          await get().loadTasks();
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to uninstall tool',
          });
        }
      },
    }),
    {
      name: 'aim.installer.store.v1',
      storage: rendererStorage,
      partialize: (state) => ({
        tasks: state.tasks,
      }),
    }
  )
);
