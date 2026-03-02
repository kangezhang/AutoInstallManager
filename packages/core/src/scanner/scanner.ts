/**
 * Scanner - 环境扫描器
 * 扫描系统中已安装的开发工具
 */

import { randomUUID } from 'crypto';
import type {
  DetectedTool,
  ScanReport,
  ScanOptions,
  ToolStatus,
  HealthStatus,
  PlatformInfo,
  ToolDefinition,
} from '@aim/shared';
import { findInPath, findAllExecutables, getSystemPaths } from './path-prober';
import { detectVersion } from './version-detector';
import { detectConflicts } from './conflict-detector';

export class Scanner {
  constructor(private platformInfo: PlatformInfo) {}

  /**
   * 扫描单个工具
   */
  async scanTool(toolDef: ToolDefinition): Promise<DetectedTool | null> {
    const { id, name, validate } = toolDef;

    if (!validate) {
      return null;
    }

    // 1. 在 PATH 中查找可执行文件
    // 从 validate.command 中提取可执行文件名（第一个单词）
    const executable = validate.command.split(' ')[0];
    const executablePath = findInPath(executable, this.platformInfo.os);

    if (!executablePath) {
      return null;
    }

    // 2. 检测版本
    // 使用完整的 validate.command 作为版本命令
    const versionCommand = validate.command.split(' ').slice(1).join(' ');
    const versionRegex = validate.pattern || '([0-9]+\\.[0-9]+\\.[0-9]+)';

    const versionResult = await detectVersion(
      executablePath,
      versionCommand,
      versionRegex
    );

    if (!versionResult.success || !versionResult.version) {
      return {
        id,
        name,
        version: 'unknown',
        path: executablePath,
        executablePath,
        status: 'broken',
        healthStatus: 'error',
        detectedAt: new Date().toISOString(),
      };
    }

    // 3. 返回检测结果
    return {
      id,
      name,
      version: versionResult.version,
      path: executablePath,
      executablePath,
      status: 'installed',
      healthStatus: 'healthy',
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * 扫描多个工具
   */
  async scanTools(
    toolDefs: ToolDefinition[],
    options: ScanOptions = {}
  ): Promise<ScanReport> {
    const scanId = randomUUID();
    const timestamp = new Date().toISOString();

    // 过滤要扫描的工具
    let toolsToScan = toolDefs;
    if (options.toolIds && options.toolIds.length > 0) {
      toolsToScan = toolDefs.filter((t) => options.toolIds!.includes(t.id));
    }

    // 扫描所有工具
    const scanResults = await Promise.all(
      toolsToScan.map((toolDef) => this.scanTool(toolDef))
    );

    // 过滤掉未检测到的工具
    const detectedTools = scanResults.filter(
      (tool): tool is DetectedTool => tool !== null
    );

    // 检测冲突
    const conflicts = detectConflicts(detectedTools);

    // 生成摘要
    const summary = {
      total: detectedTools.length,
      healthy: detectedTools.filter((t) => t.healthStatus === 'healthy').length,
      warnings: detectedTools.filter((t) => t.healthStatus === 'warning').length,
      errors: detectedTools.filter((t) => t.healthStatus === 'error').length,
    };

    return {
      scanId,
      timestamp,
      platform: {
        os: this.platformInfo.os,
        arch: this.platformInfo.arch,
        version: this.platformInfo.version,
      },
      detectedTools,
      conflicts,
      summary,
    };
  }
}
