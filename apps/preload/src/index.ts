import { contextBridge, ipcRenderer } from 'electron';
import type {
  PlatformInfo,
  ToolDefinition,
  ScanReport,
  InstallTask,
  InstallProgress,
  DownloadProgress
} from '@aim/shared';

// 定义暴露给渲染进程的 API
const api = {
  // Platform API
  platform: {
    getInfo: () => ipcRenderer.invoke('platform:getInfo') as Promise<PlatformInfo>,
  },

  // Catalog API
  catalog: {
    load: () => ipcRenderer.invoke('catalog:load') as Promise<void>,
    getTool: (id: string) => ipcRenderer.invoke('catalog:getTool', id) as Promise<ToolDefinition | null>,
    listTools: (filters?: { platform?: string; arch?: string; tags?: string[] }) =>
      ipcRenderer.invoke('catalog:listTools', filters) as Promise<ToolDefinition[]>,
    getVersions: (toolId: string) =>
      ipcRenderer.invoke('catalog:getVersions', toolId) as Promise<string[]>,
  },

  // Scanner API
  scanner: {
    start: () => ipcRenderer.invoke('scan:start') as Promise<ScanReport>,
    scanTool: (toolId: string) => ipcRenderer.invoke('scan:tool', toolId) as Promise<ScanReport>,
    getReport: () => ipcRenderer.invoke('scan:getReport') as Promise<ScanReport | null>,
  },

  // Installer API
  installer: {
    createTask: (toolId: string, version: string, options?: any) =>
      ipcRenderer.invoke('install:create', toolId, version, options) as Promise<InstallTask>,
    start: (taskId: string) => ipcRenderer.invoke('install:start', taskId) as Promise<void>,
    cancel: (taskId: string) => ipcRenderer.invoke('install:cancel', taskId) as Promise<void>,
    getStatus: (taskId: string) => ipcRenderer.invoke('install:status', taskId) as Promise<InstallTask | null>,
    listTasks: () => ipcRenderer.invoke('install:list') as Promise<InstallTask[]>,
  },

  // Events API
  events: {
    onInstallProgress: (callback: (progress: InstallProgress) => void) => {
      const listener = (_event: any, progress: InstallProgress) => callback(progress);
      ipcRenderer.on('event:installProgress', listener);
      return () => ipcRenderer.removeListener('event:installProgress', listener);
    },
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
      const listener = (_event: any, progress: DownloadProgress) => callback(progress);
      ipcRenderer.on('event:downloadProgress', listener);
      return () => ipcRenderer.removeListener('event:downloadProgress', listener);
    },
    onScanComplete: (callback: (report: ScanReport) => void) => {
      const listener = (_event: any, report: ScanReport) => callback(report);
      ipcRenderer.on('event:scanComplete', listener);
      return () => ipcRenderer.removeListener('event:scanComplete', listener);
    },
  },
};

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', api);

// 类型声明
export type ElectronAPI = typeof api;
