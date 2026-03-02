/**
 * Conflict Detector - 冲突检测器
 * 检测工具之间的冲突和问题
 */

import type { DetectedTool, ToolConflict } from '@aim/shared';

/**
 * 检测重复安装
 */
export function detectDuplicateInstallations(
  tools: DetectedTool[]
): ToolConflict[] {
  const conflicts: ToolConflict[] = [];
  const toolGroups = new Map<string, DetectedTool[]>();

  // 按工具 ID 分组
  for (const tool of tools) {
    const existing = toolGroups.get(tool.id) || [];
    existing.push(tool);
    toolGroups.set(tool.id, existing);
  }

  // 检测重复
  for (const [toolId, instances] of toolGroups) {
    if (instances.length > 1) {
      conflicts.push({
        toolId,
        type: 'duplicate-installation',
        severity: 'warning',
        message: `Found ${instances.length} installations of ${instances[0].name}`,
        affectedPaths: instances.map((t) => t.path),
        suggestion: 'Consider removing duplicate installations to avoid conflicts',
      });
    }
  }

  return conflicts;
}

/**
 * 检测路径冲突
 */
export function detectPathConflicts(tools: DetectedTool[]): ToolConflict[] {
  const conflicts: ToolConflict[] = [];
  const pathMap = new Map<string, DetectedTool[]>();

  // 按路径分组
  for (const tool of tools) {
    const existing = pathMap.get(tool.path) || [];
    existing.push(tool);
    pathMap.set(tool.path, existing);
  }

  // 检测冲突
  for (const [path, instances] of pathMap) {
    if (instances.length > 1) {
      const toolIds = instances.map((t) => t.id);
      conflicts.push({
        toolId: toolIds.join(','),
        type: 'path-conflict',
        severity: 'error',
        message: `Multiple tools installed at the same path: ${path}`,
        affectedPaths: [path],
        suggestion: 'This is likely a configuration error',
      });
    }
  }

  return conflicts;
}

/**
 * 检测所有冲突
 */
export function detectConflicts(tools: DetectedTool[]): ToolConflict[] {
  return [
    ...detectDuplicateInstallations(tools),
    ...detectPathConflicts(tools),
  ];
}
