/**
 * macOS pkgutil Scanner
 * 扫描 macOS 中通过 pkg 安装的软件包
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 软件包信息
 */
export interface PackageInfo {
  id: string;
  version?: string;
  location?: string;
  installTime?: string;
  volume?: string;
}

/**
 * 获取所有已安装的包
 */
export async function listInstalledPackages(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('pkgutil --pkgs', {
      encoding: 'utf8',
      timeout: 10000,
    });
    return stdout.trim().split('\n').filter(Boolean);
  } catch (error) {
    return [];
  }
}

/**
 * 获取包的详细信息
 */
export async function getPackageInfo(packageId: string): Promise<PackageInfo | null> {
  try {
    const { stdout } = await execAsync(`pkgutil --pkg-info "${packageId}"`, {
      encoding: 'utf8',
      timeout: 5000,
    });

    const info: PackageInfo = { id: packageId };
    const lines = stdout.split('\n');

    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();

      switch (key.trim()) {
        case 'version':
          info.version = value;
          break;
        case 'location':
          info.location = value;
          break;
        case 'install-time':
          info.installTime = value;
          break;
        case 'volume':
          info.volume = value;
          break;
      }
    }

    return info;
  } catch (error) {
    return null;
  }
}

/**
 * 搜索特定的包
 */
export async function findPackage(searchTerm: string): Promise<PackageInfo[]> {
  const allPackages = await listInstalledPackages();
  const matchingPackages = allPackages.filter((pkg) =>
    pkg.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const packageInfos = await Promise.all(
    matchingPackages.map((pkg) => getPackageInfo(pkg))
  );

  return packageInfos.filter((info): info is PackageInfo => info !== null);
}
