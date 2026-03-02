/**
 * Windows Registry Scanner
 * 扫描 Windows 注册表中的已安装程序
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 注册表项信息
 */
export interface RegistryEntry {
  name: string;
  version?: string;
  installLocation?: string;
  publisher?: string;
  installDate?: string;
}

/**
 * 常见的注册表路径
 */
const REGISTRY_PATHS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

/**
 * 查询注册表项
 */
async function queryRegistryKey(keyPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`reg query "${keyPath}" /s`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    return stdout;
  } catch (error) {
    return '';
  }
}

/**
 * 解析注册表输出
 */
function parseRegistryOutput(output: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const lines = output.split('\n');

  let currentEntry: Partial<RegistryEntry> = {};
  let hasDisplayName = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 新的注册表项
    if (trimmed.startsWith('HKEY_')) {
      if (hasDisplayName && currentEntry.name) {
        entries.push(currentEntry as RegistryEntry);
      }
      currentEntry = {};
      hasDisplayName = false;
      continue;
    }

    // 解析键值对
    const match = trimmed.match(/^\s*(\w+)\s+REG_\w+\s+(.*)$/);
    if (match) {
      const [, key, value] = match;

      switch (key) {
        case 'DisplayName':
          currentEntry.name = value;
          hasDisplayName = true;
          break;
        case 'DisplayVersion':
          currentEntry.version = value;
          break;
        case 'InstallLocation':
          currentEntry.installLocation = value;
          break;
        case 'Publisher':
          currentEntry.publisher = value;
          break;
        case 'InstallDate':
          currentEntry.installDate = value;
          break;
      }
    }
  }

  // 添加最后一个条目
  if (hasDisplayName && currentEntry.name) {
    entries.push(currentEntry as RegistryEntry);
  }

  return entries;
}

/**
 * 扫描 Windows 注册表
 */
export async function scanWindowsRegistry(): Promise<RegistryEntry[]> {
  const allEntries: RegistryEntry[] = [];

  for (const path of REGISTRY_PATHS) {
    const output = await queryRegistryKey(path);
    const entries = parseRegistryOutput(output);
    allEntries.push(...entries);
  }

  return allEntries;
}

/**
 * 在注册表中搜索特定程序
 */
export async function findInRegistry(
  searchName: string
): Promise<RegistryEntry | null> {
  const entries = await scanWindowsRegistry();
  const lowerSearchName = searchName.toLowerCase();

  return (
    entries.find((entry) => entry.name.toLowerCase().includes(lowerSearchName)) ||
    null
  );
}
