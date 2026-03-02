/**
 * Path Prober - PATH 探测器
 * 在系统 PATH 和自定义路径中搜索可执行文件
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { OS } from '@aim/shared';

/**
 * 获取系统 PATH 列表
 */
export function getSystemPaths(): string[] {
  const pathEnv = process.env.PATH || '';
  const separator = process.platform === 'win32' ? ';' : ':';
  return pathEnv.split(separator).filter(Boolean);
}

/**
 * 获取可执行文件的可能扩展名
 */
export function getExecutableExtensions(os: OS): string[] {
  return os === 'win' ? ['.exe', '.cmd', '.bat', '.ps1'] : [''];
}

/**
 * 在指定路径中搜索可执行文件
 */
export function findExecutable(
  executableName: string,
  searchPaths: string[],
  os: OS
): string | null {
  const extensions = getExecutableExtensions(os);

  for (const searchPath of searchPaths) {
    for (const ext of extensions) {
      const fullName = executableName + ext;
      const fullPath = join(searchPath, fullName);

      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * 在 PATH 中搜索可执行文件
 */
export function findInPath(executableName: string, os: OS): string | null {
  const systemPaths = getSystemPaths();
  return findExecutable(executableName, systemPaths, os);
}

/**
 * 在多个路径中搜索可执行文件（返回所有找到的）
 */
export function findAllExecutables(
  executableName: string,
  searchPaths: string[],
  os: OS
): string[] {
  const extensions = getExecutableExtensions(os);
  const found: string[] = [];

  for (const searchPath of searchPaths) {
    for (const ext of extensions) {
      const fullName = executableName + ext;
      const fullPath = join(searchPath, fullName);

      if (existsSync(fullPath)) {
        found.push(fullPath);
      }
    }
  }

  return found;
}
