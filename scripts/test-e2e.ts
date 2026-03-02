/**
 * 端到端测试脚本
 * 测试完整的 UI 集成流程
 */

import { detectPlatform } from '../packages/adapters/dist/index.js';
import { CatalogLoader, VersionResolverFactory, Scanner, Installer } from '../packages/core/dist/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runE2ETest() {
  console.log('🚀 Starting End-to-End Test...\n');

  try {
    // 1. 测试平台检测
    console.log('1️⃣  Testing Platform Detection...');
    const platformInfo = await detectPlatform();
    console.log('✅ Platform detected:', {
      os: platformInfo.os,
      arch: platformInfo.arch,
      version: platformInfo.version,
      isAdmin: platformInfo.isAdmin,
    });
    console.log('');

    // 2. 测试 Catalog 加载
    console.log('2️⃣  Testing Catalog Loading...');
    const catalogPath = path.join(process.cwd(), 'catalog');
    const catalogLoader = new CatalogLoader();
    const catalog = await catalogLoader.load({ catalogPath });
    const tools = catalog.tools;
    console.log(`✅ Loaded ${tools.length} tools from catalog`);
    tools.forEach((tool) => {
      console.log(`   - ${tool.name} (${tool.id})`);
    });
    console.log('');

    // 3. 测试版本解析
    console.log('3️⃣  Testing Version Resolution...');
    if (tools.length > 0) {
      const firstTool = tools[0];
      console.log(`   Testing with: ${firstTool.name}`);
      const resolver = VersionResolverFactory.getResolver(firstTool.versionSource);
      const versions = await resolver.resolve(firstTool.versionSource);
      console.log(`✅ Resolved ${versions.length} versions`);
      if (versions.length > 0) {
        console.log(`   Latest: ${versions[0].version}`);
      }
    }
    console.log('');

    // 4. 测试环境扫描
    console.log('4️⃣  Testing Environment Scanner...');
    const scanner = new Scanner(platformInfo);
    const scanReport = await scanner.scanTools(tools);
    console.log('✅ Scan completed:');
    console.log(`   Total tools: ${scanReport.summary.total}`);
    console.log(`   Healthy: ${scanReport.summary.healthy}`);
    console.log(`   Warnings: ${scanReport.summary.warnings}`);
    console.log(`   Errors: ${scanReport.summary.errors}`);
    console.log('');

    if (scanReport.detectedTools.length > 0) {
      console.log('   Detected tools:');
      scanReport.detectedTools.forEach((tool) => {
        console.log(
          `   - ${tool.name} v${tool.version} (${tool.healthStatus})`
        );
      });
    }
    console.log('');

    // 5. 测试安装器（创建任务）
    console.log('5️⃣  Testing Installer (Task Creation)...');
    const installer = new Installer(platformInfo);
    if (tools.length > 0) {
      const testTool = tools[0];
      const task = installer.createTask(testTool, { version: 'latest' });
      console.log('✅ Task created:');
      console.log(`   ID: ${task.id}`);
      console.log(`   Tool: ${task.toolName}`);
      console.log(`   Version: ${task.version}`);
      console.log(`   Status: ${task.status}`);
    }
    console.log('');

    // 6. 测试冲突检测
    if (scanReport.conflicts && scanReport.conflicts.length > 0) {
      console.log('6️⃣  Conflicts Detected:');
      scanReport.conflicts.forEach((conflict, index) => {
        console.log(`   ${index + 1}. ${conflict.type}: ${conflict.description}`);
      });
      console.log('');
    }

    console.log('✅ All E2E tests passed! 🎉\n');
    console.log('📊 Summary:');
    console.log(`   - Platform: ${platformInfo.os}-${platformInfo.arch}`);
    console.log(`   - Tools in catalog: ${tools.length}`);
    console.log(`   - Tools detected: ${scanReport.detectedTools.length}`);
    console.log(`   - Conflicts: ${scanReport.conflicts?.length || 0}`);
    console.log('');

    return true;
  } catch (error) {
    console.error('❌ E2E Test Failed:', error);
    return false;
  }
}

// 运行测试
runE2ETest()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
