const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
import * as fs from 'node:fs/promises';
import { detectPlatform } from '@aim/adapters';
import { CatalogLoader, CatalogValidator, VersionResolverFactory, Scanner, Installer } from '@aim/core';
import type { PlatformInfo, LoadedCatalog, ToolDefinition } from '@aim/shared';

const __dirname = __dirname || path.dirname(require.main?.filename || '');

let mainWindow: BrowserWindow | null = null;
let platformInfo: PlatformInfo;
let catalog: LoadedCatalog;

const catalogLoader = new CatalogLoader();
const catalogValidator = new CatalogValidator();
let scanner: Scanner;
let installer: Installer;

const getCatalogDir = () => path.join(process.cwd(), 'catalog');

async function reloadCatalog() {
  const catalogDir = getCatalogDir();
  catalogLoader.clearCache();
  catalog = await catalogLoader.load({ catalogDir });
  installer.setCatalogTools(catalog.tools);
  return catalog;
}

function setupIpcHandlers() {
  ipcMain.handle('platform:getInfo', async () => {
    return await detectPlatform();
  });

  ipcMain.handle('catalog:load', async () => {
    await reloadCatalog();
  });

  ipcMain.handle('catalog:getTool', async (_event, id: string) => {
    if (!catalog) return null;
    const catalogDir = getCatalogDir();
    return await catalogLoader.getTool(catalogDir, id);
  });

  ipcMain.handle('catalog:listTools', async () => {
    if (!catalog) return [];
    return catalog.tools;
  });

  ipcMain.handle('catalog:getVersions', async (_event, toolId: string) => {
    if (!catalog) return [];
    const tool = catalog.tools.find((t) => t.id === toolId);
    if (!tool) return [];
    const resolver = VersionResolverFactory.getResolver(tool.versionSource);
    const versions = await resolver.resolve(tool.versionSource);
    return versions.map((v) => v.version);
  });

  ipcMain.handle(
    'catalog:addToolDefinition',
    async (_event, definitionContent: string, options?: { overwrite?: boolean }) => {
      if (typeof definitionContent !== 'string' || definitionContent.trim().length === 0) {
        throw new Error('Tool definition content cannot be empty');
      }

      const catalogDir = getCatalogDir();
      await fs.mkdir(catalogDir, { recursive: true });

      const tempFileName = `.tmp-tool-${Date.now()}-${Math.random().toString(16).slice(2)}.yaml`;
      const tempFilePath = path.join(catalogDir, tempFileName);
      const normalizedContent = `${definitionContent.trimEnd()}\n`;

      await fs.writeFile(tempFilePath, normalizedContent, 'utf-8');

      let tool: ToolDefinition;
      try {
        tool = await catalogValidator.loadToolDefinition(tempFilePath);
      } finally {
        await fs.rm(tempFilePath, { force: true });
      }

      const targetPath = path.join(catalogDir, `${tool.id}.yaml`);
      if (!options?.overwrite) {
        try {
          await fs.access(targetPath);
          throw new Error(
            `Tool "${tool.id}" already exists. Enable overwrite to replace it.`
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }

      await fs.writeFile(targetPath, normalizedContent, 'utf-8');
      await reloadCatalog();
      return tool;
    }
  );

  ipcMain.handle('scan:start', async () => {
    if (!catalog) return null;
    return await scanner.scanTools(catalog.tools);
  });

  ipcMain.handle('scan:tool', async (_event, toolId: string) => {
    if (!catalog) throw new Error('Catalog not loaded');
    const tool = catalog.tools.find((t) => t.id === toolId);
    if (!tool) throw new Error(`Tool not found: ${toolId}`);
    return await scanner.scanTool(tool);
  });

  ipcMain.handle('scan:getReport', async () => {
    return scanner.getLastReport();
  });

  ipcMain.handle('install:create', async (_event, toolId: string, version: string, options?: any) => {
    if (!catalog) throw new Error('Catalog not loaded');
    const tool = catalog.tools.find((t) => t.id === toolId);
    if (!tool) throw new Error(`Tool not found: ${toolId}`);
    return installer.createTask(tool, { version, ...options });
  });

  ipcMain.handle('install:start', async (_event, taskId: string) => {
    const task = installer.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!catalog) throw new Error('Catalog not loaded');
    const tool = catalog.tools.find((t) => t.id === task.toolId);
    if (!tool) throw new Error(`Tool not found: ${task.toolId}`);
    return await installer.install(tool, { version: task.version }, taskId);
  });

  ipcMain.handle('install:cancel', async (_event, taskId: string) => {
    return installer.cancelTask(taskId);
  });

  ipcMain.handle('install:rollback', async (_event, toolId: string) => {
    return await installer.rollback(toolId);
  });

  ipcMain.handle('install:uninstall', async (_event, toolId: string) => {
    return await installer.uninstall(toolId);
  });

  ipcMain.handle('install:status', async (_event, taskId: string) => {
    return installer.getTask(taskId);
  });

  ipcMain.handle('install:list', async () => {
    return installer.getAllTasks();
  });

  installer.on('progress', (progress) => {
    mainWindow?.webContents.send('event:installProgress', progress);
  });

  installer.on('downloadProgress', (progress) => {
    mainWindow?.webContents.send('event:downloadProgress', progress);
  });

  scanner.on('complete', (report) => {
    mainWindow?.webContents.send('event:scanComplete', report);
  });
}

async function createWindow() {
  const shouldOpenDevTools =
    process.env.NODE_ENV === 'development' || process.env.AIM_OPEN_DEVTOOLS === '1';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload/dist/index.cjs'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
  }

  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isToggleDevTools =
      key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i');
    if (isToggleDevTools) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        console.error('Renderer failed to load:', {
          errorCode,
          errorDescription,
          validatedURL,
        });
      }
    }
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app
  .whenReady()
  .then(async () => {
    platformInfo = await detectPlatform();
    console.log('Platform detected:', platformInfo);

    scanner = new Scanner(platformInfo);
    installer = new Installer(platformInfo);

    setupIpcHandlers();
    await createWindow();
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize app:', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error: unknown) => {
      console.error('Failed to recreate window:', error);
    });
  }
});
