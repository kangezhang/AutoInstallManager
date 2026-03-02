/**
 * Windows Installer - Windows 平台安装器
 * 支持 MSI 和 EXE 安装包
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { InstallResult } from '@aim/shared';

const execAsync = promisify(exec);

/**
 * 安装 MSI 包
 */
export async function installMSI(
  msiPath: string,
  options: {
    silent?: boolean;
    targetDir?: string;
    requiresAdmin?: boolean;
  } = {}
): Promise<InstallResult> {
  try {
    const { silent = true, targetDir, requiresAdmin = false } = options;

    // 构建 msiexec 命令
    let command = 'msiexec /i';
    command += ` "${msiPath}"`;

    if (silent) {
      command += ' /qn'; // 静默安装
    }

    if (targetDir) {
      command += ` INSTALLDIR="${targetDir}"`;
    }

    // 添加日志
    command += ' /l*v "%TEMP%\\msi_install.log"';

    // 执行安装
    const { stdout, stderr } = await execAsync(command, {
      timeout: 600000, // 10 分钟超时
      windowsHide: true,
    });

    return {
      success: true,
      installedPath: targetDir,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'MSI installation failed',
    };
  }
}

/**
 * 安装 EXE 包
 */
export async function installEXE(
  exePath: string,
  options: {
    silent?: boolean;
    silentArgs?: string;
    targetDir?: string;
    requiresAdmin?: boolean;
  } = {}
): Promise<InstallResult> {
  try {
    const { silent = true, silentArgs, targetDir, requiresAdmin = false } = options;

    // 构建命令
    let command = `"${exePath}"`;

    if (silent && silentArgs) {
      command += ` ${silentArgs}`;
    }

    if (targetDir) {
      // 常见的目标目录参数
      command += ` /D="${targetDir}"`;
    }

    // 执行安装
    const { stdout, stderr } = await execAsync(command, {
      timeout: 600000, // 10 分钟超时
      windowsHide: true,
    });

    return {
      success: true,
      installedPath: targetDir,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'EXE installation failed',
    };
  }
}

/**
 * 卸载程序（通过注册表）
 */
export async function uninstallWindows(
  productName: string
): Promise<InstallResult> {
  try {
    // 查找卸载字符串
    const registryPaths = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ];

    for (const path of registryPaths) {
      try {
        const { stdout } = await execAsync(
          `reg query "${path}" /s /f "${productName}"`,
          { timeout: 30000 }
        );

        // 解析卸载字符串
        const uninstallMatch = stdout.match(/UninstallString\s+REG_SZ\s+(.+)/);
        if (uninstallMatch) {
          const uninstallCommand = uninstallMatch[1].trim();

          // 执行卸载
          await execAsync(uninstallCommand + ' /S', {
            timeout: 600000,
            windowsHide: true,
          });

          return {
            success: true,
          };
        }
      } catch {
        // 继续尝试下一个路径
        continue;
      }
    }

    return {
      success: false,
      error: 'Uninstall string not found',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Uninstall failed',
    };
  }
}
