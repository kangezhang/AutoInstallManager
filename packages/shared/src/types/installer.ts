/**
 * Installer Type Definitions
 */

import type { OS, Arch } from './platform';

/**
 * 安装状态
 */
export type InstallStatus =
  | 'pending' // 等待中
  | 'downloading' // 下载中
  | 'downloaded' // 下载完成
  | 'installing' // 安装中
  | 'installed' // 安装完成
  | 'failed' // 失败
  | 'cancelled'; // 已取消

/**
 * 任务类型
 */
export type TaskType = 'install' | 'uninstall' | 'update';

/**
 * 下载进度
 */
export interface DownloadProgress {
  total: number; // 总字节数
  downloaded: number; // 已下载字节数
  percent: number; // 百分比（0-100）
  speed: number; // 下载速度（字节/秒）
  eta: number; // 预计剩余时间（秒）
}

/**
 * 安装进度
 */
export interface InstallProgress {
  status: InstallStatus;
  message: string;
  percent: number; // 百分比（0-100）
  downloadProgress?: DownloadProgress;
}

/**
 * 安装任务
 */
export interface InstallTask {
  id: string; // 任务 ID
  type: TaskType; // 任务类型
  toolId: string; // 工具 ID
  toolName: string; // 工具名称
  version: string; // 版本号
  status: InstallStatus; // 状态
  progress: InstallProgress; // 进度
  createdAt: string; // 创建时间（ISO 8601）
  startedAt?: string; // 开始时间
  completedAt?: string; // 完成时间
  error?: string; // 错误信息
}

/**
 * 安装选项
 */
export interface InstallOptions {
  version?: string; // 指定版本（默认最新稳定版）
  targetDir?: string; // 安装目录
  silent?: boolean; // 静默安装
  force?: boolean; // 强制安装（覆盖已存在）
}

/**
 * 下载选项
 */
export interface DownloadOptions {
  url: string; // 下载 URL
  destPath: string; // 目标路径
  sha256?: string; // SHA256 校验和
  timeout?: number; // 超时时间（毫秒）
  onProgress?: (progress: DownloadProgress) => void; // 进度回调
}

/**
 * 下载结果
 */
export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
  verified?: boolean; // 是否通过校验
}

/**
 * 安装结果
 */
export interface InstallResult {
  success: boolean;
  installedPath?: string;
  version?: string;
  error?: string;
}
