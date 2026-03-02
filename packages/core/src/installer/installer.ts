/**
 * Installer - 安装流程控制器
 * 协调下载、安装和验证流程
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  InstallTask,
  InstallOptions,
  InstallResult,
  InstallStatus,
  PlatformInfo,
  ToolDefinition,
} from '@aim/shared';
import { downloadFile } from './downloader';
import {
  GitHubReleasesResolver,
  StaticListResolver,
  type VersionInfo,
} from '../catalog/version-resolver';

export class Installer {
  private tasks = new Map<string, InstallTask>();

  constructor(private platformInfo: PlatformInfo) {}

  /**
   * 创建安装任务
   */
  createTask(
    toolDef: ToolDefinition,
    options: InstallOptions = {}
  ): InstallTask {
    const taskId = randomUUID();
    const task: InstallTask = {
      id: taskId,
      type: 'install',
      toolId: toolDef.id,
      toolName: toolDef.name,
      version: options.version || 'latest',
      status: 'pending',
      progress: {
        status: 'pending',
        message: 'Waiting to start',
        percent: 0,
      },
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): InstallTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): InstallTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 更新任务状态
   */
  private updateTask(taskId: string, updates: Partial<InstallTask>): void {
    const task = this.tasks.get(taskId);
    if (task) {
      Object.assign(task, updates);
    }
  }

  /**
   * 安装工具
   */
  async install(
    toolDef: ToolDefinition,
    options: InstallOptions = {}
  ): Promise<InstallResult> {
    const task = this.createTask(toolDef, options);

    try {
      // 1. 解析版本
      this.updateTask(task.id, {
        status: 'pending',
        progress: {
          status: 'pending',
          message: 'Resolving version...',
          percent: 5,
        },
      });

      // 创建版本解析器
      let versions: VersionInfo[] = [];
      if (toolDef.versionSource.type === 'githubReleases') {
        const resolver = new GitHubReleasesResolver();
        versions = await resolver.resolve(toolDef.versionSource);
      } else if (toolDef.versionSource.type === 'staticList') {
        const resolver = new StaticListResolver();
        versions = await resolver.resolve(toolDef.versionSource);
      }

      let targetVersion = options.version;
      if (!targetVersion || targetVersion === 'latest') {
        // 获取最新稳定版
        const stableVersions = versions.filter((v: VersionInfo) => !v.prerelease);
        if (stableVersions.length === 0) {
          throw new Error('No stable versions available');
        }
        targetVersion = stableVersions[0].version;
      }

      // 2. 查找对应平台的资产
      const asset = toolDef.assets.find(
        (a) =>
          a.platform === this.platformInfo.os &&
          a.arch === this.platformInfo.arch
      );

      if (!asset) {
        throw new Error(
          `No asset found for ${this.platformInfo.os}-${this.platformInfo.arch}`
        );
      }

      // 3. 下载文件
      this.updateTask(task.id, {
        status: 'downloading',
        progress: {
          status: 'downloading',
          message: 'Downloading...',
          percent: 10,
        },
        startedAt: new Date().toISOString(),
      });

      const downloadUrl = asset.url.replace(/\$\{version\}/g, targetVersion);
      const fileName = downloadUrl.split('/').pop() || 'download';
      const downloadPath = join(tmpdir(), 'autoinstall', task.id, fileName);

      const downloadResult = await downloadFile({
        url: downloadUrl,
        destPath: downloadPath,
        sha256: asset.sha256,
        onProgress: (progress) => {
          this.updateTask(task.id, {
            progress: {
              status: 'downloading',
              message: `Downloading... ${progress.percent.toFixed(1)}%`,
              percent: 10 + progress.percent * 0.6, // 10-70%
              downloadProgress: progress,
            },
          });
        },
      });

      if (!downloadResult.success) {
        throw new Error(downloadResult.error || 'Download failed');
      }

      // 4. 安装
      this.updateTask(task.id, {
        status: 'installing',
        progress: {
          status: 'installing',
          message: 'Installing...',
          percent: 75,
        },
      });

      // TODO: 调用平台特定的安装器
      // 这里暂时返回成功，实际安装逻辑将在平台安装器中实现

      // 5. 完成
      this.updateTask(task.id, {
        status: 'installed',
        progress: {
          status: 'installed',
          message: 'Installation completed',
          percent: 100,
        },
        completedAt: new Date().toISOString(),
      });

      return {
        success: true,
        version: targetVersion,
        installedPath: options.targetDir,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.updateTask(task.id, {
        status: 'failed',
        progress: {
          status: 'failed',
          message: `Installation failed: ${errorMessage}`,
          percent: 0,
        },
        error: errorMessage,
        completedAt: new Date().toISOString(),
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (task.status === 'pending' || task.status === 'downloading') {
      this.updateTask(taskId, {
        status: 'cancelled',
        progress: {
          status: 'cancelled',
          message: 'Installation cancelled',
          percent: 0,
        },
        completedAt: new Date().toISOString(),
      });
      return true;
    }

    return false;
  }
}
