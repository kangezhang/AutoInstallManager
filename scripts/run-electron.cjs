#!/usr/bin/env node

const { spawn } = require('node:child_process');

let electronBinary;
try {
  electronBinary = require('electron');
} catch (error) {
  console.error('[run-electron] Failed to resolve Electron binary.');
  console.error('[run-electron] Run `pnpm install` and try again.');
  if (error && error.message) {
    console.error(error.message);
  }
  process.exit(1);
}

const args = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, args, {
  stdio: 'inherit',
  windowsHide: false,
  env,
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error(`[run-electron] Electron exited with signal: ${signal}`);
    process.exit(1);
  }
  process.exit(code);
});
