/**
 * Scanner Type Definitions
 */

import type { OS, Arch } from './platform';

/**
 * 工具安装状态
 */
export type ToolStatus = 'installed' | 'not-found' | 'broken' | 'conflict';

/**
 * 健康状态
 */
export type HealthStatus = 'healthy' | 'warning' | 'error';

/**
 * 扫描到的工具实例
 */
export interface DetectedTool {
  id: string; // 工具 ID（对应 catalog 中的定义）
  name: string; // 工具名称
  version: string; // 检测到的版本
  path: string; // 安装路径
  executablePath: string; // 可执行文件路径
  status: ToolStatus; // 安装状态
  healthStatus: HealthStatus; // 健康状态
  detectedAt: string; // 检测时间（ISO 8601）
  metadata?: {
    installedBy?: string; // 安装方式（如 'msi', 'pkg', 'manual'）
    installDate?: string; // 安装日期
    size?: number; // 安装大小（字节）
    [key: string]: unknown;
  };
}

/**
 * 工具冲突信息
 */
export interface ToolConflict {
  toolId: string;
  type: 'version-mismatch' | 'duplicate-installation' | 'path-conflict';
  severity: 'warning' | 'error';
  message: string;
  affectedPaths: string[];
  suggestion?: string;
}

/**
 * 扫描报告
 */
export interface ScanReport {
  scanId: string; // 扫描 ID
  timestamp: string; // 扫描时间（ISO 8601）
  platform: {
    os: OS;
    arch: Arch;
    version: string;
  };
  detectedTools: DetectedTool[]; // 检测到的工具列表
  conflicts: ToolConflict[]; // 冲突列表
  summary: {
    total: number; // 总工具数
    healthy: number; // 健康工具数
    warnings: number; // 警告数
    errors: number; // 错误数
  };
}

/**
 * 扫描选项
 */
export interface ScanOptions {
  toolIds?: string[]; // 指定要扫描的工具 ID（为空则扫描所有）
  includePaths?: string[]; // 额外的搜索路径
  excludePaths?: string[]; // 排除的路径
  deep?: boolean; // 是否深度扫描（扫描注册表、pkgutil 等）
  timeout?: number; // 超时时间（毫秒）
}

/**
 * 版本检测结果
 */
export interface VersionDetectionResult {
  success: boolean;
  version?: string;
  error?: string;
  rawOutput?: string;
}
