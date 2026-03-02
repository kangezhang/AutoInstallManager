#!/usr/bin/env node
import { CatalogLoader, VersionResolverFactory, sortVersions, getLatestVersion } from '../packages/core/dist/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const catalogDir = path.join(__dirname, '..', 'catalog');
  const loader = new CatalogLoader();

  console.log('🔍 Testing Catalog Loader...\n');

  // Test 1: Load all tools
  console.log('Test 1: Load all tools');
  const catalog = await loader.load({ catalogDir });
  console.log(`✅ Loaded ${catalog.tools.length} tools`);
  catalog.tools.forEach((tool) => {
    console.log(`  - ${tool.name} (${tool.id}): ${tool.assets.length} assets`);
  });
  console.log();

  // Test 2: Load with platform filter
  console.log('Test 2: Load with platform filter (win/x64)');
  const winCatalog = await loader.load({
    catalogDir,
    platform: 'win',
    arch: 'x64',
  });
  console.log(`✅ Loaded ${winCatalog.tools.length} tools for Windows x64`);
  winCatalog.tools.forEach((tool) => {
    console.log(`  - ${tool.name}: ${tool.assets.length} asset(s)`);
    tool.assets.forEach((asset) => {
      console.log(`    ${asset.platform}/${asset.arch}: ${asset.type}`);
    });
  });
  console.log();

  // Test 3: Get specific tool
  console.log('Test 3: Get specific tool (nodejs)');
  const nodejs = await loader.getTool(catalogDir, 'nodejs', 'win', 'x64');
  if (nodejs) {
    console.log(`✅ Found ${nodejs.name}`);
    console.log(`  Homepage: ${nodejs.homepage}`);
    console.log(`  Tags: ${nodejs.tags?.join(', ')}`);
    console.log(`  Version source: ${nodejs.versionSource.type}`);
  }
  console.log();

  // Test 4: Resolve versions from GitHub
  console.log('Test 4: Resolve versions from GitHub (nodejs/node)');
  try {
    const resolver = VersionResolverFactory.getResolver(nodejs!.versionSource);
    const versions = await resolver.resolve(nodejs!.versionSource);
    const sorted = sortVersions(versions);
    const latest = getLatestVersion(versions);

    console.log(`✅ Found ${versions.length} versions`);
    console.log(`  Latest stable: ${latest?.version}`);
    console.log(`  Top 5 versions:`);
    sorted.slice(0, 5).forEach((v) => {
      console.log(`    - ${v.version}${v.prerelease ? ' (prerelease)' : ''}`);
    });
  } catch (error) {
    console.error(`❌ Failed to resolve versions: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log();

  console.log('✅ All tests completed!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
