#!/usr/bin/env node
import { CatalogValidator } from '../packages/core/dist/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const catalogDir = path.join(__dirname, '..', 'catalog');
  const validator = new CatalogValidator();

  console.log('🔍 Validating catalog files...\n');
  console.log(`Directory: ${catalogDir}\n`);

  const result = await validator.validateDirectory(catalogDir);

  if (result.valid) {
    console.log('✅ All catalog files are valid!\n');
    process.exit(0);
  } else {
    console.error('❌ Validation failed:\n');
    for (const error of result.errors) {
      console.error(`File: ${error.file}`);
      if (error.path) {
        console.error(`Path: ${error.path}`);
      }
      console.error(`Error: ${error.message}\n`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
