/**
 * Installer type definitions
 */

/**
 * Task lifecycle status.
 */
export type InstallStatus =
  | 'pending'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'rolling-back'
  | 'rolled-back'
  | 'uninstalling'
  | 'uninstalled'
  | 'failed'
  | 'cancelled';

/**
 * Task type.
 */
export type TaskType = 'install' | 'uninstall' | 'update' | 'rollback';

/**
 * Download progress payload.
 */
export interface DownloadProgress {
  total: number;
  downloaded: number;
  percent: number;
  speed: number;
  eta: number;
}

/**
 * Installation progress payload.
 */
export interface InstallProgress {
  status: InstallStatus;
  message: string;
  percent: number;
  downloadProgress?: DownloadProgress;
}

/**
 * Per-task console log entry.
 */
export interface TaskLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/**
 * Installation task model.
 */
export interface InstallTask {
  id: string;
  type: TaskType;
  toolId: string;
  toolName: string;
  version: string;
  status: InstallStatus;
  progress: InstallProgress;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  installedPath?: string;
  rollbackAvailable?: boolean;
  error?: string;
  logs?: TaskLogEntry[];
}

/**
 * Installation options.
 */
export interface InstallOptions {
  version?: string;
  targetDir?: string;
  silent?: boolean;
  force?: boolean;
}

/**
 * Download options.
 */
export interface DownloadOptions {
  url: string;
  destPath: string;
  sha256?: string;
  timeout?: number;
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Download result.
 */
export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
  verified?: boolean;
}

/**
 * Install / uninstall / rollback result.
 */
export interface InstallResult {
  success: boolean;
  installedPath?: string;
  version?: string;
  error?: string;
}
