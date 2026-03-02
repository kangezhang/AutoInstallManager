/**
 * macOS Installer - macOS 平台安装器
 * 支持 PKG 和 DMG 安装包
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { InstallResult } from '@aim/shared';

const execAsync = promisify(exec);

/**
 * 安装 PKG 包
 */
export async function installPKG(
  pkgPath: string,
  options: {
    targetDir?: string;
    requiresAdmin?: boolean;
  } = {}
): Promise<InstallResult> {
  try {
    const { targetDir = '/', requiresAdmin = true } = options;

    // 构建 installer 命令
    let command = 'installer';
    command += ` -pkg "${pkgPath}"`;
    command += ` -target ${targetDir}`;

    // PKG 安装通常需要 sudo
    if (requiresAdmin) {
      command = `sudo ${command}`;
    }

    // 执行安装
    const { stdout, stderr } = await execAsync(command, {
      timeout: 600000, // 10 分钟超时
    });

    return {
      success: true,
      installedPath: targetDir,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PKG installation failed',
    };
  }
}

/**
 * 挂载 DMG 并安装
 */
export async function installDMG(
  dmgPath: string,
  options: {
    appName?: string;
    targetDir?: string;
  } = {}
): Promise<InstallResult> {
  try {
    const { appName, targetDir = '/Applications' } = options;

    // 1. 挂载 DMG
    const { stdout: mountOutput } = await execAsync(
      `hdiutil attach "${dmgPath}" -nobrowse -quiet`,
      { timeout: 60000 }
    );

    // 解析挂载点
    const mountMatch = mountOutput.match(/\/Volumes\/(.+)/);
    if (!mountMatch) {
      throw new Error('Failed to parse mount point');
    }

    const mountPoint = mountMatch[0].trim();

    try {
      // 2. 查找 .app 文件
      const { stdout: lsOutput } = await execAsync(`ls "${mountPoint}"`, {
        timeout: 10000,
      });

      const apps = lsOutput
        .split('\n')
        .filter((line) => line.endsWith('.app'));

      if (apps.length === 0) {
        throw new Error('No .app found in DMG');
      }

      const appToInstall = appName
        ? apps.find((app) => app === appName)
        : apps[0];

      if (!appToInstall) {
        throw new Error(`App ${appName} not found in DMG`);
      }

      // 3. 复制到 Applications
      await execAsync(
        `cp -R "${mountPoint}/${appToInstall}" "${targetDir}/"`,
        { timeout: 300000 }
      );

      // 4. 卸载 DMG
      await execAsync(`hdiutil detach "${mountPoint}" -quiet`, {
        timeout: 30000,
      });

      return {
        success: true,
        installedPath: `${targetDir}/${appToInstall}`,
      };
    } catch (error) {
      // 确保卸载 DMG
      try {
        await execAsync(`hdiutil detach "${mountPoint}" -force -quiet`);
      } catch {
        // 忽略卸载错误
      }
      throw error;
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'DMG installation failed',
    };
  }
}

/**
 * 卸载 macOS 应用
 */
export async function uninstallMacOS(
  appName: string,
  options: {
    targetDir?: string;
  } = {}
): Promise<InstallResult> {
  try {
    const { targetDir = '/Applications' } = options;
    const appPath = `${targetDir}/${appName}`;

    // 删除应用
    await execAsync(`rm -rf "${appPath}"`, {
      timeout: 60000,
    });

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Uninstall failed',
    };
  }
}
