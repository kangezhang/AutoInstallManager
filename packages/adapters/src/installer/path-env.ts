import { exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { promisify } from 'util';
import type { PlatformInfo } from '@aim/shared';

const execAsync = promisify(exec);

export interface PathUpdateResult {
  success: boolean;
  updated: boolean;
  pathEntry: string;
  error?: string;
}

export async function addPathToUserEnvironment(
  pathEntry: string,
  platformInfo: PlatformInfo
): Promise<PathUpdateResult> {
  const normalizedEntry = resolve(pathEntry);

  try {
    if (platformInfo.os === 'win') {
      const updated = await addPathOnWindows(normalizedEntry);
      return { success: true, updated, pathEntry: normalizedEntry };
    }

    if (platformInfo.os === 'mac') {
      const updated = addPathOnMacOS(normalizedEntry);
      return { success: true, updated, pathEntry: normalizedEntry };
    }

    return {
      success: false,
      updated: false,
      pathEntry: normalizedEntry,
      error: `Unsupported platform for PATH update: ${platformInfo.os}`,
    };
  } catch (error) {
    return {
      success: false,
      updated: false,
      pathEntry: normalizedEntry,
      error: error instanceof Error ? error.message : 'Failed to update PATH',
    };
  }
}

async function addPathOnWindows(pathEntry: string): Promise<boolean> {
  const currentPath = await getWindowsUserPath();
  const entries = splitPathEntries(currentPath, ';');

  const exists = entries.some((entry) => entry.toLowerCase() === pathEntry.toLowerCase());
  if (exists) {
    return false;
  }

  const nextPath = [...entries, pathEntry].join(';');
  const escaped = nextPath.replace(/'/g, "''");
  const command = `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${escaped}','User')"`;
  await execAsync(command, { windowsHide: true });
  return true;
}

async function getWindowsUserPath(): Promise<string> {
  const { stdout } = await execAsync(
    'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"',
    { windowsHide: true }
  );
  return stdout.trim();
}

function addPathOnMacOS(pathEntry: string): boolean {
  const profilePath = join(homedir(), '.zprofile');
  const exportLine = `export PATH="${pathEntry}:$PATH" # AutoInstallManager`;

  const existing = existsSync(profilePath)
    ? readFileSync(profilePath, 'utf8')
    : '';

  if (hasPathEntry(existing, pathEntry)) {
    return false;
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const next = `${existing}${separator}${exportLine}\n`;
  writeFileSync(profilePath, next, 'utf8');
  return true;
}

function hasPathEntry(content: string, pathEntry: string): boolean {
  if (!content) return false;
  return content.split('\n').some((line) => line.includes(pathEntry));
}

function splitPathEntries(pathValue: string, separator: string): string[] {
  if (!pathValue) return [];
  return pathValue
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
