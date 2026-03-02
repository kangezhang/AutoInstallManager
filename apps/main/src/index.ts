import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPlatform } from '@aim/adapters';
import { CatalogLoader, VersionResolverFactory, Scanner, Installer } from '@aim/core';
import type { PlatformInfo, LoadedCatalog } from '@aim/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let platformInfo: PlatformInfo;
let catalog: LoadedCatalog;

// 初始化核心服务
const catalogLoader = new CatalogLoader();
let scanner: Scanner;
let installer: Installer;

// 设置 IPC 处理器
function setupIpcHandlers() {
  // Platform API
  ipcMain.handle('platform:getInfo', async () => {
    return await detectPlatform();
  });

  // Catalog API
  ipcMain.handle('catalog:load', async () => {
    const catalogPath = path.join(process.cwd(), 'catalog');
    catalog = await catalogLoader.load({ catalogPath });
  });

  ipcMain.handle('catalog:getTool', async (_event, id: string) => {
    if (!catalog) return null;
    return await catalogLoader.getTool(id, { catalogPath: path.join(process.cwd(), 'catalog') });
  });

  ipcMain.handle('catalog:listTools', async (_event, filters?: any) => {
    if (!catalog) return [];
    return catalog.tools;
  });

  ipcMain.handle('catalog:getVersions', async (_event, toolId: string) => {
    if (!catalog) return [];
    const tool = catalog.tools.find(t => t.id === toolId);
    if (!tool) return [];
    const resolver = VersionResolverFactory.create(tool.versionSource);
    const versions = await resolver.resolve(tool.versionSource);
    return versions.map(v => v.version);
  });

  // Scanner API
  ipcMain.handle('scan:start', async () => {
    if (!catalog) return null;
    return await scanner.scanTools(catalog.tools);
  });

  ipcMain.handle('scan:tool', async (_event, toolId: string) => {
    if (!catalog) throw new Error('Catalog not loaded');
    const tool = catalog.tools.find(t => t.id === toolId);
    if (!tool) throw new Error(`Tool not found: ${toolId}`);
    return await scanner.scanTool(tool);
  });

  ipcMain.handle('scan:getReport', async () => {
    return scanner.getLastReport();
  });

  // Installer API
  ipcMain.handle('install:create', async (_event, toolId: string, version: string, options?: any) => {
    if (!catalog) throw new Error('Catalog not loaded');
    const tool = catalog.tools.find(t => t.id === toolId);
    if (!tool) throw new Error(`Tool not found: ${toolId}`);
    return installer.createTask(tool, { version, ...options });
  });

  ipcMain.handle('install:start', async (_event, taskId: string) => {
    const task = installer.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!catalog) throw new Error('Catalog not loaded');
    const tool = catalog.tools.find(t => t.id === task.toolId);
    if (!tool) throw new Error(`Tool not found: ${task.toolId}`);
    return await installer.install(tool, { version: task.version });
  });

  ipcMain.handle('install:cancel', async (_event, taskId: string) => {
    return installer.cancelTask(taskId);
  });

  ipcMain.handle('install:status', async (_event, taskId: string) => {
    return installer.getTask(taskId);
  });

  ipcMain.handle('install:list', async () => {
    return installer.getAllTasks();
  });

  // 设置事件转发
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
  // 检测平台信息
  platformInfo = await detectPlatform();
  console.log('Platform detected:', platformInfo);

  // 初始化 Scanner 和 Installer（需要平台信息）
  scanner = new Scanner(platformInfo);
  installer = new Installer(platformInfo);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload/dist/index.js'),
    },
  });

  // 开发环境加载 Vite 开发服务器
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境加载打包后的文件
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
