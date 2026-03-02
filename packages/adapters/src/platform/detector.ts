import os from 'node:os';
import path from 'node:path';
import type { PlatformInfo, OS, Arch } from '@aim/shared';

/**
 * 检测当前平台信息
 */
export async function detectPlatform(): Promise<PlatformInfo> {
  const platform = os.platform();
  const arch = os.arch();

  // 检测 OS
  let detectedOS: OS;
  if (platform === 'win32') {
    detectedOS = 'win';
  } else if (platform === 'darwin') {
    detectedOS = 'mac';
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // 检测 Arch
  let detectedArch: Arch;
  if (arch === 'x64') {
    detectedArch = 'x64';
  } else if (arch === 'arm64') {
    detectedArch = 'arm64';
  } else {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  // 检测 OS 版本
  const version = os.release();

  // 检测是否管理员权限（简化版）
  const isAdmin = process.getuid ? process.getuid() === 0 : false;

  // 确定关键路径
  const home = os.homedir();
  const appData =
    detectedOS === 'win'
      ? process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
      : path.join(home, 'Library', 'Application Support');

  const temp = os.tmpdir();
  const managed = path.join(appData, 'AutoInstallManager', 'tools');

  return {
    os: detectedOS,
    arch: detectedArch,
    version,
    isAdmin,
    paths: {
      home,
      appData,
      temp,
      managed,
    },
  };
}
