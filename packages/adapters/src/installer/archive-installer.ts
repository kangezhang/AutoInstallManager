/**
 * Archive Installer - 压缩包解压安装器
 * 支持 ZIP 和 TAR.GZ 格式
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { InstallResult } from '@aim/shared';

const execAsync = promisify(exec);

/**
 * 解压 ZIP 文件
 */
export async function extractZIP(
  zipPath: string,
  targetDir: string
): Promise<InstallResult> {
  try {
    // 确保目标目录存在
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // 根据平台选择解压命令
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      // Windows: 使用 PowerShell
      const command = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`;
      await execAsync(command, { timeout: 300000 });
    } else {
      // Unix: 使用 unzip
      await execAsync(`unzip -o "${zipPath}" -d "${targetDir}"`, {
        timeout: 300000,
      });
    }

    return {
      success: true,
      installedPath: targetDir,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'ZIP extraction failed',
    };
  }
}

/**
 * 解压 TAR.GZ 文件
 */
export async function extractTarGz(
  tarGzPath: string,
  targetDir: string
): Promise<InstallResult> {
  try {
    // 确保目标目录存在
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // 使用 tar 命令解压
    await execAsync(`tar -xzf "${tarGzPath}" -C "${targetDir}"`, {
      timeout: 300000,
    });

    return {
      success: true,
      installedPath: targetDir,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'TAR.GZ extraction failed',
    };
  }
}

/**
 * 根据文件扩展名自动选择解压方法
 */
export async function extractArchive(
  archivePath: string,
  targetDir: string
): Promise<InstallResult> {
  const lowerPath = archivePath.toLowerCase();

  if (lowerPath.endsWith('.zip')) {
    return extractZIP(archivePath, targetDir);
  } else if (lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz')) {
    return extractTarGz(archivePath, targetDir);
  } else {
    return {
      success: false,
      error: `Unsupported archive format: ${archivePath}`,
    };
  }
}
