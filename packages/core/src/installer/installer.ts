/**
 * Installer
 * Coordinates version resolution, download, install, and rollback.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'path';
import { tmpdir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { chmod, rename, rm } from 'fs/promises';
import { promisify } from 'util';
import * as semver from 'semver';
import type {
  InstallTask,
  InstallOptions,
  InstallResult,
  InstallStatus,
  TaskLogEntry,
  PlatformInfo,
  ToolDefinition,
  TaskType,
  Asset,
} from '@aim/shared';
import {
  addPathToUserEnvironment,
  extractArchive,
  installDMG,
  installEXE,
  installMSI,
  installPKG,
  uninstallMacOS,
  uninstallWindows,
} from '@aim/adapters';
import { downloadFile } from './downloader';
import {
  GitHubReleasesResolver,
  StaticListResolver,
  sortVersions,
  type VersionInfo,
} from '../catalog/version-resolver';

const execAsync = promisify(exec);

interface RollbackSnapshot {
  backupPath?: string;
  previousVersion?: string;
  previousInstalledPath?: string;
  createdAt: string;
}

interface InstalledToolState {
  toolId: string;
  toolName: string;
  version: string;
  installedPath: string;
  assetType: Asset['type'];
  installedAt: string;
  rollback?: RollbackSnapshot;
}

interface InstallStateFile {
  tools: Record<string, InstalledToolState>;
}

interface PostInstallContext {
  version: string;
  installedPath: string;
  targetDir: string;
  toolId: string;
  managed: string;
}

type GitHubTokenProvider = (toolDef: ToolDefinition) => Promise<string | undefined>;

export class Installer extends EventEmitter {
  private tasks = new Map<string, InstallTask>();
  private installedTools: Record<string, InstalledToolState> = {};
  private stateFilePath: string;
  private catalogTools = new Map<string, ToolDefinition>();
  private githubTokenProvider?: GitHubTokenProvider;

  constructor(private platformInfo: PlatformInfo) {
    super();
    this.stateFilePath = join(
      this.platformInfo.paths.appData,
      'AutoInstallManager',
      'state',
      'installed-tools.json'
    );
    this.installedTools = this.loadInstalledToolsState();
  }

  createTask(
    toolDef: ToolDefinition,
    options: InstallOptions = {},
    type: TaskType = 'install'
  ): InstallTask {
    return this.createTaskEntry({
      type,
      toolId: toolDef.id,
      toolName: toolDef.name,
      version: options.version || 'latest',
    });
  }

  setCatalogTools(tools: ToolDefinition[]): void {
    this.catalogTools = new Map(tools.map((tool) => [tool.id, tool]));
  }

  setGitHubTokenProvider(provider: GitHubTokenProvider): void {
    this.githubTokenProvider = provider;
  }

  getTask(taskId: string): InstallTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): InstallTask[] {
    const tasks = Array.from(this.tasks.values());
    const stateTaskToolIds = new Set(
      tasks
        .filter((task) => task.status === 'installed' || task.status === 'rolled-back')
        .map((task) => task.toolId)
    );

    for (const record of Object.values(this.installedTools)) {
      if (stateTaskToolIds.has(record.toolId)) {
        continue;
      }

      tasks.push({
        id: `state-${record.toolId}`,
        type: 'install',
        toolId: record.toolId,
        toolName: record.toolName,
        version: record.version,
        status: 'installed',
        progress: {
          status: 'installed',
          message: 'Installed',
          percent: 100,
        },
        createdAt: record.installedAt,
        completedAt: record.installedAt,
        installedPath: record.installedPath,
        rollbackAvailable: Boolean(
          record.rollback?.backupPath || record.rollback?.previousInstalledPath
        ),
        logs: [
          {
            timestamp: record.installedAt,
            level: 'info',
            message: 'Loaded from installed state',
          },
        ],
      });
    }

    return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async install(
    toolDef: ToolDefinition,
    options: InstallOptions = {},
    taskId?: string,
    dependencyTrail?: Set<string>
  ): Promise<InstallResult> {
    const task = this.resolveInstallTask(toolDef, options, taskId);
    const resolvedTrail = dependencyTrail ? new Set(dependencyTrail) : new Set<string>();
    resolvedTrail.add(toolDef.id);
    let targetDir = '';
    let backupPath: string | undefined;
    let downloadPath: string | undefined;

    try {
      this.appendTaskLog(task.id, 'info', `Install requested for ${toolDef.id} (${task.version})`);
      this.updateTask(task.id, {
        status: 'pending',
        progress: {
          status: 'pending',
          message: 'Resolving version...',
          percent: 5,
        },
      });

      await this.ensureDependenciesInstalled(toolDef, resolvedTrail);

      const targetVersion = await this.resolveTargetVersion(toolDef, task.version);
      this.updateTask(task.id, { version: targetVersion });
      this.appendTaskLog(task.id, 'info', `Resolved version: ${targetVersion}`);

      const asset = this.selectAssetForPlatform(toolDef);
      targetDir = this.resolveTargetDir(toolDef, targetVersion, options.targetDir);
      this.appendTaskLog(
        task.id,
        'info',
        `Selected asset: ${asset.platform}/${asset.arch} ${asset.type}; target: ${targetDir}`
      );

      this.updateTask(task.id, {
        status: 'pending',
        progress: {
          status: 'pending',
          message: 'Preparing rollback snapshot...',
          percent: 8,
        },
      });

      backupPath = await this.prepareTargetDir(targetDir, options.force === true);
      if (backupPath) {
        this.appendTaskLog(task.id, 'info', `Prepared rollback snapshot at ${backupPath}`);
      }

      this.updateTask(task.id, {
        status: 'downloading',
        progress: {
          status: 'downloading',
          message: 'Downloading...',
          percent: 10,
        },
        startedAt: new Date().toISOString(),
      });

      const downloadUrl = this.resolveVersionTemplate(asset.url, targetVersion);
      const githubToken = await this.resolveToolGitHubToken(toolDef);
      const downloadRequest = await this.resolveDownloadRequest(
        toolDef,
        targetVersion,
        downloadUrl,
        githubToken
      );
      const fileName = this.resolveDownloadFileName(downloadUrl, downloadRequest.url);
      downloadPath = join(tmpdir(), 'autoinstall', task.id, fileName);
      this.appendTaskLog(task.id, 'info', `Downloading from ${downloadRequest.url}`);

      const downloadResult = await downloadFile({
        url: downloadRequest.url,
        headers: downloadRequest.headers,
        destPath: downloadPath,
        sha256: asset.sha256,
        onProgress: (progress) => {
          this.emit('downloadProgress', {
            taskId: task.id,
            ...progress,
          });

          this.updateTask(task.id, {
            progress: {
              status: 'downloading',
              message: `Downloading... ${progress.percent.toFixed(1)}%`,
              percent: 10 + progress.percent * 0.6,
              downloadProgress: progress,
            },
          });
        },
      });

      if (!downloadResult.success || !downloadResult.filePath) {
        throw new Error(downloadResult.error || 'Download failed');
      }
      this.appendTaskLog(task.id, 'info', `Downloaded artifact to ${downloadResult.filePath}`);

      this.updateTask(task.id, {
        status: 'installing',
        progress: {
          status: 'installing',
          message: 'Installing...',
          percent: 75,
        },
      });

      const installResult = await this.performInstall(
        asset,
        downloadResult.filePath,
        toolDef,
        targetDir,
        options
      );

      if (!installResult.success) {
        throw new Error(installResult.error || 'Install command failed');
      }

      const installedPath = installResult.installedPath || targetDir;
      this.appendTaskLog(task.id, 'info', `Install step completed at ${installedPath}`);

      this.updateTask(task.id, {
        status: 'installing',
        progress: {
          status: 'installing',
          message: 'Running post-install actions...',
          percent: 85,
        },
      });

      await this.runPostInstallActions(toolDef, targetVersion, installedPath);

      this.updateTask(task.id, {
        status: 'installing',
        progress: {
          status: 'installing',
          message: 'Validating installation...',
          percent: 90,
        },
      });

      await this.validateInstalledTool(toolDef, targetVersion, installedPath);
      this.appendTaskLog(task.id, 'info', 'Validation passed');

      const previousState = this.installedTools[toolDef.id];

      const rollbackSnapshot: RollbackSnapshot | undefined = previousState
        ? {
            backupPath,
            previousVersion: previousState.version,
            previousInstalledPath: previousState.installedPath,
            createdAt: new Date().toISOString(),
          }
        : backupPath
          ? {
              backupPath,
              createdAt: new Date().toISOString(),
            }
          : undefined;

      this.installedTools[toolDef.id] = {
        toolId: toolDef.id,
        toolName: toolDef.name,
        version: targetVersion,
        installedPath,
        assetType: asset.type,
        installedAt: new Date().toISOString(),
        rollback: rollbackSnapshot,
      };
      this.saveInstalledToolsState();

      this.updateTask(task.id, {
        status: 'installed',
        progress: {
          status: 'installed',
          message: 'Installation completed',
          percent: 100,
        },
        installedPath,
        rollbackAvailable: Boolean(
          rollbackSnapshot?.backupPath || rollbackSnapshot?.previousInstalledPath
        ),
        completedAt: new Date().toISOString(),
      });
      this.appendTaskLog(task.id, 'info', 'Installation completed');

      return {
        success: true,
        version: targetVersion,
        installedPath,
      };
    } catch (error) {
      const rollbackSucceeded = await this.restoreRollbackSnapshot(targetDir, backupPath);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error && error.stack ? error.stack : null;
      const rollbackMessage = backupPath
        ? rollbackSucceeded
          ? ' Previous version restored.'
          : ' Rollback failed.'
        : '';
      this.appendTaskLog(task.id, 'error', `Installation failed: ${errorMessage}`);
      if (stack) {
        this.appendTaskLog(task.id, 'error', stack);
      }
      if (backupPath) {
        this.appendTaskLog(
          task.id,
          rollbackSucceeded ? 'info' : 'warn',
          rollbackSucceeded ? 'Rollback snapshot restored' : 'Rollback snapshot restore failed'
        );
      }

      this.updateTask(task.id, {
        status: 'failed',
        progress: {
          status: 'failed',
          message: `Installation failed: ${errorMessage}${rollbackMessage}`,
          percent: 0,
        },
        error: `${errorMessage}${rollbackMessage}`,
        completedAt: new Date().toISOString(),
      });

      return {
        success: false,
        error: `${errorMessage}${rollbackMessage}`,
      };
    } finally {
      await this.cleanupTaskTemp(task.id);
    }
  }

  async rollback(toolId: string): Promise<InstallResult> {
    const record = this.installedTools[toolId];
    if (!record) {
      return { success: false, error: `No install record found for ${toolId}` };
    }

    const task = this.createTaskEntry({
      type: 'rollback',
      toolId: record.toolId,
      toolName: record.toolName,
      version: record.version,
    });
    this.appendTaskLog(task.id, 'info', `Rollback requested for ${toolId}`);

    this.updateTask(task.id, {
      status: 'rolling-back',
      startedAt: new Date().toISOString(),
      progress: {
        status: 'rolling-back',
        message: 'Rolling back...',
        percent: 50,
      },
    });

    try {
      if (!record.rollback) {
        throw new Error('No rollback snapshot available');
      }

      const snapshot = record.rollback;
      let restoredPath = record.installedPath;

      if (snapshot.backupPath && existsSync(snapshot.backupPath)) {
        if (existsSync(record.installedPath)) {
          await rm(record.installedPath, { recursive: true, force: true });
        }
        await rename(snapshot.backupPath, record.installedPath);
      } else if (
        snapshot.previousInstalledPath &&
        existsSync(snapshot.previousInstalledPath)
      ) {
        if (
          snapshot.previousInstalledPath !== record.installedPath &&
          existsSync(record.installedPath)
        ) {
          await rm(record.installedPath, { recursive: true, force: true });
        }
        restoredPath = snapshot.previousInstalledPath;
      } else {
        throw new Error('Rollback snapshot not found on disk');
      }

      const restoredVersion = snapshot.previousVersion || record.version;
      this.installedTools[toolId] = {
        ...record,
        version: restoredVersion,
        installedPath: restoredPath,
        rollback: undefined,
        installedAt: new Date().toISOString(),
      };
      this.saveInstalledToolsState();

      this.updateTask(task.id, {
        status: 'rolled-back',
        version: restoredVersion,
        rollbackAvailable: false,
        installedPath: restoredPath,
        completedAt: new Date().toISOString(),
        progress: {
          status: 'rolled-back',
          message: 'Rollback completed',
          percent: 100,
        },
      });
      this.appendTaskLog(task.id, 'info', 'Rollback completed');

      return {
        success: true,
        version: restoredVersion,
        installedPath: restoredPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Rollback failed';
      this.appendTaskLog(task.id, 'error', `Rollback failed: ${errorMessage}`);
      this.updateTask(task.id, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
        progress: {
          status: 'failed',
          message: `Rollback failed: ${errorMessage}`,
          percent: 0,
        },
      });
      return { success: false, error: errorMessage };
    }
  }

  async uninstall(toolId: string): Promise<InstallResult> {
    const record = this.installedTools[toolId];
    if (!record) {
      return { success: false, error: `No install record found for ${toolId}` };
    }

    const task = this.createTaskEntry({
      type: 'uninstall',
      toolId: record.toolId,
      toolName: record.toolName,
      version: record.version,
    });
    this.appendTaskLog(task.id, 'info', `Uninstall requested for ${toolId}`);

    this.updateTask(task.id, {
      status: 'uninstalling',
      startedAt: new Date().toISOString(),
      progress: {
        status: 'uninstalling',
        message: 'Uninstalling...',
        percent: 30,
      },
    });

    try {
      let removed = false;
      if (record.installedPath && existsSync(record.installedPath)) {
        await rm(record.installedPath, { recursive: true, force: true });
        removed = true;
        this.appendTaskLog(task.id, 'info', `Removed managed path ${record.installedPath}`);
      }

      if (!removed) {
        await this.tryPlatformUninstall(record);
        this.appendTaskLog(task.id, 'info', 'Executed platform uninstall fallback');
      }

      if (record.rollback?.backupPath && existsSync(record.rollback.backupPath)) {
        await rm(record.rollback.backupPath, { recursive: true, force: true });
      }

      delete this.installedTools[toolId];
      this.saveInstalledToolsState();

      this.updateTask(task.id, {
        status: 'uninstalled',
        rollbackAvailable: false,
        completedAt: new Date().toISOString(),
        progress: {
          status: 'uninstalled',
          message: 'Uninstall completed',
          percent: 100,
        },
      });
      this.appendTaskLog(task.id, 'info', 'Uninstall completed');

      return { success: true, installedPath: record.installedPath, version: record.version };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Uninstall failed';
      this.appendTaskLog(task.id, 'error', `Uninstall failed: ${errorMessage}`);
      this.updateTask(task.id, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
        progress: {
          status: 'failed',
          message: `Uninstall failed: ${errorMessage}`,
          percent: 0,
        },
      });
      return { success: false, error: errorMessage };
    }
  }

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
          message: 'Task cancelled',
          percent: 0,
        },
        completedAt: new Date().toISOString(),
      });
      return true;
    }

    return false;
  }

  private createTaskEntry(input: {
    type: TaskType;
    toolId: string;
    toolName: string;
    version: string;
  }): InstallTask {
    const taskId = randomUUID();
    const createdAt = new Date().toISOString();
    const task: InstallTask = {
      id: taskId,
      type: input.type,
      toolId: input.toolId,
      toolName: input.toolName,
      version: input.version,
      status: 'pending',
      progress: {
        status: 'pending',
        message: 'Waiting to start',
        percent: 0,
      },
      createdAt,
      logs: [
        {
          timestamp: createdAt,
          level: 'info',
          message: `Task created (${input.type})`,
        },
      ],
    };

    this.tasks.set(taskId, task);
    return task;
  }

  private updateTask(taskId: string, updates: Partial<InstallTask>): void {
    const task = this.tasks.get(taskId);
    if (task) {
      const previousStatus = task.status;
      Object.assign(task, updates);
      if (updates.status && updates.status !== previousStatus) {
        this.appendTaskLog(taskId, 'info', `Status changed: ${previousStatus} -> ${updates.status}`);
      }
      if (updates.progress) {
        this.appendTaskLog(
          taskId,
          'info',
          `[${updates.progress.status}] ${updates.progress.message} (${Math.round(updates.progress.percent)}%)`
        );
      }
      if (updates.error) {
        this.appendTaskLog(taskId, 'error', updates.error);
      }
      if (updates.progress) {
        this.emit('progress', {
          taskId,
          ...updates.progress,
        });
      }
    }
  }

  private appendTaskLog(taskId: string, level: TaskLogEntry['level'], message: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    if (!task.logs) {
      task.logs = [];
    }

    task.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }

  private resolveInstallTask(
    toolDef: ToolDefinition,
    options: InstallOptions,
    taskId?: string
  ): InstallTask {
    if (!taskId) {
      return this.createTask(toolDef, options, 'install');
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.type !== 'install') {
      throw new Error(`Task ${taskId} is not an install task`);
    }
    return task;
  }

  private async resolveTargetVersion(
    toolDef: ToolDefinition,
    requestedVersion: string
  ): Promise<string> {
    if (requestedVersion && requestedVersion !== 'latest') {
      const normalizedRequested = this.normalizeVersion(requestedVersion);
      const versions = await this.resolveAvailableVersions(toolDef);
      if (versions.length === 0) {
        return normalizedRequested;
      }

      const matched = versions.find(
        (versionInfo) => this.normalizeVersion(versionInfo.version) === normalizedRequested
      );
      if (!matched) {
        throw new Error(
          `Requested version ${requestedVersion} is not available for ${toolDef.id}`
        );
      }

      return matched.version;
    }

    const versions = await this.resolveAvailableVersions(toolDef);
    const stableVersions = sortVersions(versions).filter((v) => !v.prerelease);
    if (stableVersions.length === 0) {
      throw new Error('No stable versions available');
    }
    return stableVersions[0].version;
  }

  private async resolveAvailableVersions(toolDef: ToolDefinition): Promise<VersionInfo[]> {
    if (toolDef.versionSource.type === 'githubReleases') {
      const resolver = new GitHubReleasesResolver();
      const githubToken = await this.resolveToolGitHubToken(toolDef);
      return resolver.resolve(toolDef.versionSource, { githubToken });
    }

    if (toolDef.versionSource.type === 'staticList') {
      const resolver = new StaticListResolver();
      return resolver.resolve(toolDef.versionSource);
    }

    return [];
  }

  private async resolveToolGitHubToken(toolDef: ToolDefinition): Promise<string | undefined> {
    if (!this.githubTokenProvider) {
      return undefined;
    }
    try {
      const token = await this.githubTokenProvider(toolDef);
      const normalized = token?.trim();
      return normalized || undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureDependenciesInstalled(
    toolDef: ToolDefinition,
    dependencyTrail: Set<string>
  ): Promise<void> {
    const dependencies = this.getRequiredDependencies(toolDef);
    if (dependencies.length === 0) {
      return;
    }

    for (const dependency of dependencies) {
      if (this.installedTools[dependency.id]) {
        continue;
      }

      if (dependencyTrail.has(dependency.id)) {
        const chain = [...dependencyTrail, dependency.id].join(' -> ');
        throw new Error(`Circular dependency detected: ${chain}`);
      }

      const dependencyTool = this.catalogTools.get(dependency.id);
      if (!dependencyTool) {
        throw new Error(
          `Dependency "${dependency.id}" required by "${toolDef.id}" not found in catalog`
        );
      }

      const nextTrail = new Set(dependencyTrail);
      nextTrail.add(dependency.id);

      const dependencyResult = await this.install(
        dependencyTool,
        { version: 'latest' },
        undefined,
        nextTrail
      );
      if (!dependencyResult.success) {
        throw new Error(
          `Dependency "${dependency.id}" installation failed: ${dependencyResult.error || 'Unknown error'}`
        );
      }
    }
  }

  private getRequiredDependencies(toolDef: ToolDefinition): NonNullable<ToolDefinition['dependencies']> {
    const dependencies = toolDef.dependencies || [];

    return dependencies.filter((dependency) => {
      if (dependency.type === 'hard') {
        return true;
      }

      if (dependency.type === 'platformOnly') {
        if (!dependency.platforms || dependency.platforms.length === 0) {
          return true;
        }
        return dependency.platforms.includes(this.platformInfo.os);
      }

      return false;
    });
  }

  private selectAssetForPlatform(toolDef: ToolDefinition): Asset {
    const asset = toolDef.assets.find(
      (a) => a.platform === this.platformInfo.os && a.arch === this.platformInfo.arch
    );

    if (!asset) {
      throw new Error(`No asset found for ${this.platformInfo.os}-${this.platformInfo.arch}`);
    }
    return asset;
  }

  private resolveTargetDir(
    toolDef: ToolDefinition,
    version: string,
    explicitTargetDir?: string
  ): string {
    const template =
      explicitTargetDir ||
      toolDef.install.targetDir ||
      '{managed}/{toolId}/{version}';

    const rendered = template
      .replaceAll('{managed}', this.platformInfo.paths.managed)
      .replaceAll('{toolId}', toolDef.id)
      .replaceAll('{version}', version);

    return resolve(rendered);
  }

  private resolveVersionTemplate(template: string, version: string): string {
    return template
      .replaceAll('{version}', version)
      .replaceAll('${version}', version);
  }

  private resolveDownloadFileName(originalUrl: string, resolvedUrl: string): string {
    const fromOriginal = this.extractFileNameFromUrl(originalUrl);
    if (fromOriginal) return fromOriginal;
    const fromResolved = this.extractFileNameFromUrl(resolvedUrl);
    return fromResolved || 'download';
  }

  private extractFileNameFromUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      const token = parsed.pathname.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(token);
    } catch {
      const token = rawUrl.split('?')[0].split('/').pop() || '';
      return token;
    }
  }

  private buildGitHubApiHeaders(
    token: string,
    accept = 'application/vnd.github+json'
  ): Record<string, string> {
    return {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'User-Agent': 'AutoInstallManager',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async fetchGitHubReleaseByTag(
    repo: string,
    tag: string,
    token: string
  ): Promise<
    | {
        id: number;
        tag_name: string;
        assets: Array<{ id: number; name: string; url: string; browser_download_url?: string }>;
      }
    | null
  > {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      {
        method: 'GET',
        headers: this.buildGitHubApiHeaders(token),
      }
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as {
      id: number;
      tag_name: string;
      assets: Array<{ id: number; name: string; url: string; browser_download_url?: string }>;
    };
  }

  private async resolveDownloadRequest(
    toolDef: ToolDefinition,
    targetVersion: string,
    resolvedDownloadUrl: string,
    githubToken?: string
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    if (!githubToken) {
      return { url: resolvedDownloadUrl };
    }

    const token = githubToken.trim();
    if (!token) {
      return { url: resolvedDownloadUrl };
    }

    if (toolDef.versionSource.type !== 'githubReleases') {
      return { url: resolvedDownloadUrl };
    }

    const repo = toolDef.versionSource.repo;
    const assetName = this.extractFileNameFromUrl(resolvedDownloadUrl);
    if (!assetName) {
      return {
        url: resolvedDownloadUrl,
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'AutoInstallManager' },
      };
    }

    const candidateTags = new Set<string>([targetVersion, `v${targetVersion}`]);
    for (const tag of candidateTags) {
      const release = await this.fetchGitHubReleaseByTag(repo, tag, token);
      if (!release) {
        continue;
      }

      const asset = release.assets.find((item) => item.name === assetName);
      if (!asset) {
        continue;
      }

      return {
        url: asset.url,
        headers: this.buildGitHubApiHeaders(token, 'application/octet-stream'),
      };
    }

    return {
      url: resolvedDownloadUrl,
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'AutoInstallManager' },
    };
  }

  private async prepareTargetDir(targetDir: string, force: boolean): Promise<string | undefined> {
    mkdirSync(dirname(targetDir), { recursive: true });

    if (!existsSync(targetDir)) {
      return undefined;
    }

    if (!force) {
      throw new Error(`Target already exists: ${targetDir}. Re-run with force to replace.`);
    }

    const backupPath = `${targetDir}.backup-${Date.now()}`;
    await rename(targetDir, backupPath);
    return backupPath;
  }

  private async restoreRollbackSnapshot(
    targetDir: string,
    backupPath?: string
  ): Promise<boolean> {
    try {
      if (backupPath && existsSync(backupPath)) {
        if (targetDir && existsSync(targetDir)) {
          await rm(targetDir, { recursive: true, force: true });
        }
        await rename(backupPath, targetDir);
        return true;
      }

      if (targetDir && existsSync(targetDir)) {
        await rm(targetDir, { recursive: true, force: true });
      }

      return false;
    } catch {
      return false;
    }
  }

  private async performInstall(
    asset: Asset,
    packagePath: string,
    toolDef: ToolDefinition,
    targetDir: string,
    options: InstallOptions
  ): Promise<InstallResult> {
    const silent = options.silent ?? true;
    const requiresAdmin = toolDef.install.requiresAdmin;
    const silentArgs = toolDef.install.silentArgs;

    switch (asset.type) {
      case 'zip':
      case 'tar.gz':
        return extractArchive(packagePath, targetDir);
      case 'msi':
        return installMSI(packagePath, { silent, targetDir, requiresAdmin });
      case 'exe':
        return installEXE(packagePath, { silent, silentArgs, targetDir, requiresAdmin });
      case 'pkg':
        return installPKG(packagePath, { targetDir, requiresAdmin });
      case 'dmg':
        return installDMG(packagePath, { targetDir });
      default:
        return {
          success: false,
          error: `Unsupported asset type: ${asset.type}`,
        };
    }
  }

  private async runPostInstallActions(
    toolDef: ToolDefinition,
    version: string,
    installedPath: string
  ): Promise<void> {
    const actions = toolDef.install.postInstall;
    if (!actions || actions.length === 0) {
      return;
    }

    const context: PostInstallContext = {
      version,
      installedPath,
      targetDir: installedPath,
      toolId: toolDef.id,
      managed: this.platformInfo.paths.managed,
    };

    for (const action of actions) {
      switch (action.type) {
        case 'addToPath':
          await this.executeAddToPath(action.value, context);
          break;
        case 'createShim':
          await this.executeCreateShim(toolDef, action.value, context);
          break;
        case 'runCommand':
          await this.executeRunCommand(action.value, context);
          break;
      }
    }
  }

  private async executeAddToPath(
    value: string | undefined,
    context: PostInstallContext
  ): Promise<void> {
    const rendered = value ? this.renderPostInstallTemplate(value, context) : context.installedPath;
    const targetPath = this.resolvePostInstallPath(rendered, context.installedPath);
    if (!existsSync(targetPath)) {
      throw new Error(`Post-install addToPath target does not exist: ${targetPath}`);
    }

    const persisted = await addPathToUserEnvironment(targetPath, this.platformInfo);
    if (!persisted.success) {
      throw new Error(persisted.error || `Failed to persist PATH entry: ${targetPath}`);
    }

    this.prependToProcessPath(targetPath);
  }

  private async executeCreateShim(
    toolDef: ToolDefinition,
    value: string | undefined,
    context: PostInstallContext
  ): Promise<void> {
    const rendered = value
      ? this.renderPostInstallTemplate(value, context)
      : this.deriveDefaultShimTarget(toolDef, context.installedPath);
    const targetExecutable = this.resolvePostInstallPath(rendered, context.installedPath);

    if (!existsSync(targetExecutable)) {
      throw new Error(`Post-install shim target does not exist: ${targetExecutable}`);
    }

    const shimDir = join(this.platformInfo.paths.appData, 'AutoInstallManager', 'shims');
    mkdirSync(shimDir, { recursive: true });

    const shimName = basename(targetExecutable, extname(targetExecutable)) || context.toolId;
    if (this.platformInfo.os === 'win') {
      const shimPath = join(shimDir, `${shimName}.cmd`);
      const script = `@echo off\r\n"${targetExecutable}" %*\r\n`;
      writeFileSync(shimPath, script, 'utf8');
    } else {
      const shimPath = join(shimDir, shimName);
      const script = `#!/usr/bin/env bash\n"${targetExecutable}" "$@"\n`;
      writeFileSync(shimPath, script, 'utf8');
      await chmod(shimPath, 0o755);
    }

    this.prependToProcessPath(shimDir);
  }

  private async executeRunCommand(
    value: string | undefined,
    context: PostInstallContext
  ): Promise<void> {
    if (!value || value.trim().length === 0) {
      throw new Error('Post-install runCommand requires a non-empty value');
    }

    const command = this.renderPostInstallTemplate(value, context);
    try {
      await execAsync(command, {
        cwd: context.installedPath,
        timeout: 30000,
        windowsHide: true,
        env: process.env,
      });
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      const output = `${execError.stdout || ''}\n${execError.stderr || ''}`.trim();
      const message = execError.message || 'Post-install runCommand failed';
      if (output) {
        throw new Error(`${message}. Output: ${output}`);
      }
      throw new Error(message);
    }
  }

  private deriveDefaultShimTarget(toolDef: ToolDefinition, installedPath: string): string {
    const command = toolDef.validate.command.trim();
    const token = this.extractFirstCommandToken(command);
    if (!token) {
      throw new Error('Post-install createShim cannot infer executable from validate.command');
    }

    if (isAbsolute(token)) {
      return token;
    }

    const hasExtension = extname(token).length > 0;
    const executableName =
      this.platformInfo.os === 'win' && !hasExtension ? `${token}.exe` : token;
    return join(installedPath, executableName);
  }

  private extractFirstCommandToken(command: string): string {
    const trimmed = command.trim();
    if (!trimmed) return '';

    if (trimmed.startsWith('"')) {
      const endQuote = trimmed.indexOf('"', 1);
      if (endQuote > 1) {
        return trimmed.slice(1, endQuote);
      }
    }

    const [first] = trimmed.split(/\s+/);
    return first || '';
  }

  private renderPostInstallTemplate(template: string, context: PostInstallContext): string {
    return template
      .replaceAll('{version}', context.version)
      .replaceAll('{installedPath}', context.installedPath)
      .replaceAll('{targetDir}', context.targetDir)
      .replaceAll('{toolId}', context.toolId)
      .replaceAll('{managed}', context.managed);
  }

  private resolvePostInstallPath(pathValue: string, basePath: string): string {
    if (isAbsolute(pathValue)) {
      return resolve(pathValue);
    }
    return resolve(basePath, pathValue);
  }

  private prependToProcessPath(pathEntry: string): void {
    const normalized = resolve(pathEntry);
    const current = process.env.PATH || '';
    const entries = current
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const exists = entries.some((entry) => {
      if (this.platformInfo.os === 'win') {
        return entry.toLowerCase() === normalized.toLowerCase();
      }
      return entry === normalized;
    });

    if (exists) {
      return;
    }

    process.env.PATH = [normalized, ...entries].join(delimiter);
  }

  private async validateInstalledTool(
    toolDef: ToolDefinition,
    expectedVersion: string,
    installedPath: string
  ): Promise<void> {
    const command = this.renderValidateCommand(
      toolDef.validate.command,
      expectedVersion,
      installedPath
    );

    if (!command.trim()) {
      throw new Error('Validation command is empty');
    }

    try {
      const { stdout = '', stderr = '' } = await execAsync(command, {
        timeout: 15000,
        encoding: 'utf8',
        windowsHide: true,
      });

      const output = `${stdout}\n${stderr}`.trim();
      this.assertValidationOutput(toolDef, expectedVersion, output);
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      const output = `${execError.stdout || ''}\n${execError.stderr || ''}`.trim();
      const message = execError.message || 'Validation command failed';

      if (output) {
        throw new Error(`${message}. Output: ${output}`);
      }
      throw new Error(message);
    }
  }

  private renderValidateCommand(
    command: string,
    version: string,
    installedPath: string
  ): string {
    return command
      .replaceAll('{version}', version)
      .replaceAll('{installedPath}', installedPath)
      .replaceAll('{targetDir}', installedPath);
  }

  private assertValidationOutput(
    toolDef: ToolDefinition,
    expectedVersion: string,
    output: string
  ): void {
    const parseMode = toolDef.validate.parse || 'semver';

    switch (parseMode) {
      case 'semver': {
        const detected = this.extractSemver(output);
        if (!detected) {
          throw new Error('Validation failed: no semver version found in command output');
        }
        if (!this.isVersionMatch(detected, expectedVersion)) {
          throw new Error(
            `Validation failed: detected version ${detected} does not match expected ${expectedVersion}`
          );
        }
        return;
      }
      case 'regex': {
        if (!toolDef.validate.pattern) {
          throw new Error('Validation failed: regex parse mode requires validate.pattern');
        }
        const regex = new RegExp(toolDef.validate.pattern);
        const match = output.match(regex);
        if (!match) {
          throw new Error('Validation failed: output does not match validate.pattern');
        }
        const detected = (match[1] || match[0] || '').trim();
        if (!detected) {
          throw new Error('Validation failed: regex matched empty result');
        }
        if (!this.isVersionMatch(detected, expectedVersion)) {
          throw new Error(
            `Validation failed: detected version ${detected} does not match expected ${expectedVersion}`
          );
        }
        return;
      }
      case 'exact': {
        const trimmed = output.trim();
        if (!trimmed) {
          throw new Error('Validation failed: command output is empty');
        }
        const normalizedExpected = this.normalizeVersion(expectedVersion);
        const normalizedOutput = this.normalizeVersion(trimmed);
        if (
          normalizedOutput !== normalizedExpected &&
          !trimmed.includes(expectedVersion)
        ) {
          throw new Error(
            `Validation failed: output "${trimmed}" does not match expected ${expectedVersion}`
          );
        }
      }
    }
  }

  private extractSemver(output: string): string | null {
    const candidates = output.match(/v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/g) || [];
    for (const candidate of candidates) {
      const normalized = this.normalizeVersion(candidate);
      if (semver.valid(normalized)) {
        return normalized;
      }
    }
    return null;
  }

  private isVersionMatch(detectedVersion: string, expectedVersion: string): boolean {
    const normalizedDetected = this.normalizeVersion(detectedVersion);
    const normalizedExpected = this.normalizeVersion(expectedVersion);

    if (semver.valid(normalizedDetected) && semver.valid(normalizedExpected)) {
      return semver.eq(normalizedDetected, normalizedExpected);
    }

    return normalizedDetected === normalizedExpected;
  }

  private normalizeVersion(version: string): string {
    return version.trim().replace(/^v/i, '');
  }

  private async tryPlatformUninstall(record: InstalledToolState): Promise<void> {
    if (this.platformInfo.os === 'win') {
      const result = await uninstallWindows(record.toolName);
      if (!result.success) {
        throw new Error(result.error || `Failed to uninstall ${record.toolName}`);
      }
      return;
    }

    if (this.platformInfo.os === 'mac') {
      const appName = record.toolName.endsWith('.app')
        ? record.toolName
        : `${record.toolName}.app`;
      const result = await uninstallMacOS(appName);
      if (!result.success) {
        throw new Error(result.error || `Failed to uninstall ${record.toolName}`);
      }
      return;
    }

    throw new Error(`Unsupported platform uninstall: ${this.platformInfo.os}`);
  }

  private async cleanupTaskTemp(taskId: string): Promise<void> {
    const taskTempDir = join(tmpdir(), 'autoinstall', taskId);
    if (existsSync(taskTempDir)) {
      await rm(taskTempDir, { recursive: true, force: true });
    }
  }

  private loadInstalledToolsState(): Record<string, InstalledToolState> {
    try {
      if (!existsSync(this.stateFilePath)) {
        return {};
      }

      const raw = readFileSync(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(raw) as InstallStateFile;
      return parsed.tools || {};
    } catch {
      return {};
    }
  }

  private saveInstalledToolsState(): void {
    mkdirSync(dirname(this.stateFilePath), { recursive: true });
    const state: InstallStateFile = { tools: this.installedTools };
    writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  }
}
