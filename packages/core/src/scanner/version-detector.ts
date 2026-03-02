/**
 * Version Detector - 版本检测器
 * 通过执行命令检测工具版本
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { VersionDetectionResult } from '@aim/shared';

const execAsync = promisify(exec);

/**
 * 检测工具版本
 */
export async function detectVersion(
  executablePath: string,
  versionCommand: string,
  versionRegex: string,
  timeout = 5000
): Promise<VersionDetectionResult> {
  try {
    const { stdout, stderr } = await execAsync(`"${executablePath}" ${versionCommand}`, {
      timeout,
      encoding: 'utf8',
    });

    const output = stdout || stderr;
    const regex = new RegExp(versionRegex);
    const match = output.match(regex);

    if (match && match[1]) {
      return {
        success: true,
        version: match[1],
        rawOutput: output,
      };
    }

    return {
      success: false,
      error: 'Version pattern not found in output',
      rawOutput: output,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 批量检测版本
 */
export async function detectVersions(
  detections: Array<{
    executablePath: string;
    versionCommand: string;
    versionRegex: string;
  }>
): Promise<VersionDetectionResult[]> {
  return Promise.all(
    detections.map((d) =>
      detectVersion(d.executablePath, d.versionCommand, d.versionRegex)
    )
  );
}
