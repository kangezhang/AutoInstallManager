#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveElectronDir() {
  const pkgJson = require.resolve('electron/package.json');
  return path.dirname(pkgJson);
}

function isElectronBinaryReady(electronDir) {
  const pathFile = path.join(electronDir, 'path.txt');
  if (!fs.existsSync(pathFile)) return false;

  const executable = fs.readFileSync(pathFile, 'utf8').trim();
  if (!executable) return false;

  const executablePath = path.join(electronDir, 'dist', executable);
  return fs.existsSync(executablePath);
}

function runInstallScript(electronDir) {
  const installScript = path.join(electronDir, 'install.js');
  const result = spawnSync(process.execPath, [installScript], {
    stdio: 'inherit',
    windowsHide: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Electron install script exited with code ${result.status}`);
  }
}

try {
  const electronDir = resolveElectronDir();
  if (isElectronBinaryReady(electronDir)) {
    console.log('[ensure-electron] Electron binary is ready.');
    process.exit(0);
  }

  console.log('[ensure-electron] Electron binary missing, installing...');
  runInstallScript(electronDir);

  if (!isElectronBinaryReady(electronDir)) {
    throw new Error('Electron binary is still missing after install.');
  }

  console.log('[ensure-electron] Electron binary installed.');
} catch (error) {
  console.error('[ensure-electron] Failed to ensure Electron binary.');
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}
