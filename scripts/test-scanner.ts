/**
 * Scanner 功能测试脚本
 * 测试环境扫描功能
 */

import { detectPlatform } from '../packages/adapters/dist/index.js';
import { Scanner, CatalogLoader } from '../packages/core/dist/index.js';

async function main() {
  console.log('=== Scanner 功能测试 ===\n');

  // 1. 检测平台信息
  console.log('1. 检测平台信息...');
  const platformInfo = await detectPlatform();
  console.log('✓ 平台信息:');
  console.log(`  - OS: ${platformInfo.os}`);
  console.log(`  - Arch: ${platformInfo.arch}`);
  console.log(`  - Version: ${platformInfo.version}`);
  console.log(`  - Admin: ${platformInfo.isAdmin}`);
  console.log();

  // 2. 加载 Catalog
  console.log('2. 加载工具定义...');
  const loader = new CatalogLoader();
  const catalog = await loader.load({ catalogDir: './catalog' });
  const tools = catalog.tools;
  console.log(`✓ 加载了 ${tools.length} 个工具定义`);
  console.log();

  // 3. 过滤当前平台的工具
  console.log('3. 过滤当前平台的工具...');
  const platformTools = tools.filter((tool) => {
    // 检查工具是否支持当前平台
    return tool.assets.some(
      (asset) =>
        asset.platform === platformInfo.os && asset.arch === platformInfo.arch
    );
  });
  console.log(`✓ 当前平台支持 ${platformTools.length} 个工具:`);
  platformTools.forEach((tool) => {
    console.log(`  - ${tool.name} (${tool.id})`);
  });
  console.log();

  // 4. 扫描环境
  console.log('4. 扫描环境...');
  const scanner = new Scanner(platformInfo);
  const report = await scanner.scanTools(platformTools);

  console.log(`✓ 扫描完成 (ID: ${report.scanId})`);
  console.log(`  - 扫描时间: ${report.timestamp}`);
  console.log(`  - 检测到的工具: ${report.detectedTools.length}`);
  console.log();

  // 5. 显示检测结果
  console.log('5. 检测结果:');
  if (report.detectedTools.length === 0) {
    console.log('  未检测到任何工具');
  } else {
    report.detectedTools.forEach((tool) => {
      console.log(`  - ${tool.name} v${tool.version}`);
      console.log(`    Path: ${tool.path}`);
      console.log(`    Status: ${tool.status}`);
      console.log(`    Health: ${tool.healthStatus}`);
    });
  }
  console.log();

  // 6. 显示冲突
  console.log('6. 冲突检测:');
  if (report.conflicts.length === 0) {
    console.log('  ✓ 未检测到冲突');
  } else {
    report.conflicts.forEach((conflict) => {
      console.log(`  - [${conflict.severity.toUpperCase()}] ${conflict.message}`);
      console.log(`    Type: ${conflict.type}`);
      console.log(`    Affected: ${conflict.affectedPaths.join(', ')}`);
      if (conflict.suggestion) {
        console.log(`    Suggestion: ${conflict.suggestion}`);
      }
    });
  }
  console.log();

  // 7. 显示摘要
  console.log('7. 扫描摘要:');
  console.log(`  - 总计: ${report.summary.total}`);
  console.log(`  - 健康: ${report.summary.healthy}`);
  console.log(`  - 警告: ${report.summary.warnings}`);
  console.log(`  - 错误: ${report.summary.errors}`);
  console.log();

  console.log('=== 测试完成 ===');
}

main().catch((error) => {
  console.error('测试失败:', error);
  process.exit(1);
});

