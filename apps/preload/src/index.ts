import { contextBridge, ipcRenderer } from 'electron';
import type {
  PlatformInfo,
  ToolDefinition,
  ScanReport,
  InstallTask,
  InstallResult,
  InstallProgress,
  DownloadProgress,
  ReleaseUploadRequest,
  ReleaseUploadResult,
  ReleaseDiscoverRequest,
  ReleaseDiscoverResult,
  GitHubAccountListResult,
  GitHubAccountUpsertRequest,
  GitHubAccountSummary,
  GitHubAccountCredential,
  GitHubAccountBrowserLoginResult,
  GitHubCommitInfo,
  GitHubRepoCommitsRequest,
  GitHubRepoCreateRequest,
  GitHubRepoInfo,
  GitHubRepoListMineRequest,
  GitHubRepoQueryRequest
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
    addToolDefinition: (content: string, options?: { overwrite?: boolean }) =>
      ipcRenderer.invoke('catalog:addToolDefinition', content, options) as Promise<ToolDefinition>,
    removeToolDefinition: (toolId: string) =>
      ipcRenderer.invoke('catalog:removeToolDefinition', toolId) as Promise<void>,
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
    start: (taskId: string) => ipcRenderer.invoke('install:start', taskId) as Promise<InstallResult>,
    cancel: (taskId: string) => ipcRenderer.invoke('install:cancel', taskId) as Promise<void>,
    rollback: (toolId: string) => ipcRenderer.invoke('install:rollback', toolId) as Promise<InstallResult>,
    uninstall: (toolId: string) => ipcRenderer.invoke('install:uninstall', toolId) as Promise<InstallResult>,
    getStatus: (taskId: string) => ipcRenderer.invoke('install:status', taskId) as Promise<InstallTask | null>,
    listTasks: () => ipcRenderer.invoke('install:list') as Promise<InstallTask[]>,
  },

  // Release API
  release: {
    pickAssetFile: () =>
      ipcRenderer.invoke('release:pickAssetFile') as Promise<string | null>,
    uploadAsset: (payload: ReleaseUploadRequest) =>
      ipcRenderer.invoke('release:uploadAsset', payload) as Promise<ReleaseUploadResult>,
    discoverFromLink: (payload: ReleaseDiscoverRequest) =>
      ipcRenderer.invoke('release:discoverFromLink', payload) as Promise<ReleaseDiscoverResult>,
  },

  // GitHub Account API
  githubAccount: {
    list: () => ipcRenderer.invoke('githubAccount:list') as Promise<GitHubAccountListResult>,
    upsert: (payload: GitHubAccountUpsertRequest) =>
      ipcRenderer.invoke('githubAccount:upsert', payload) as Promise<GitHubAccountSummary>,
    remove: (accountId: string) =>
      ipcRenderer.invoke('githubAccount:remove', accountId) as Promise<void>,
    setDefault: (accountId: string) =>
      ipcRenderer.invoke('githubAccount:setDefault', accountId) as Promise<void>,
    getDefaultCredential: () =>
      ipcRenderer.invoke('githubAccount:getDefaultCredential') as Promise<GitHubAccountCredential | null>,
    loginWithBrowser: (host?: string) =>
      ipcRenderer.invoke('githubAccount:loginWithBrowser', host) as Promise<GitHubAccountBrowserLoginResult>,
  },

  // GitHub Repository API
  githubRepo: {
    create: (payload: GitHubRepoCreateRequest) =>
      ipcRenderer.invoke('githubRepo:create', payload) as Promise<GitHubRepoInfo>,
    listMine: (payload?: GitHubRepoListMineRequest) =>
      ipcRenderer.invoke('githubRepo:listMine', payload) as Promise<GitHubRepoInfo[]>,
    getInfo: (payload: GitHubRepoQueryRequest) =>
      ipcRenderer.invoke('githubRepo:getInfo', payload) as Promise<GitHubRepoInfo>,
    listCommits: (payload: GitHubRepoCommitsRequest) =>
      ipcRenderer.invoke('githubRepo:listCommits', payload) as Promise<GitHubCommitInfo[]>,
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
