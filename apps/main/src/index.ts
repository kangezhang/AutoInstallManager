const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { detectPlatform } from '@aim/adapters';
import { CatalogLoader, CatalogValidator, VersionResolverFactory, Scanner, Installer } from '@aim/core';
import type {
  GitHubAccountUpsertRequest,
  PlatformInfo,
  LoadedCatalog,
  ToolDefinition,
  ReleaseDiscoverRequest,
  ReleaseDiscoverResult,
  ReleaseUploadRequest,
  ReleaseUploadResult,
} from '@aim/shared';
import {
  getGitHubAccountCredential,
  loginGitHubAccountWithBrowser,
  listGitHubAccounts,
  removeGitHubAccount,
  setDefaultGitHubAccount,
  upsertGitHubAccount,
} from './github-accounts';

const __dirname = __dirname || path.dirname(require.main?.filename || '');

let mainWindow: BrowserWindow | null = null;
let platformInfo: PlatformInfo;
let catalog: LoadedCatalog;

const catalogLoader = new CatalogLoader();
const catalogValidator = new CatalogValidator();
let scanner: Scanner;
let installer: Installer;

const getCatalogDir = () => path.join(process.cwd(), 'catalog');

interface GitHubReleaseInfo {
  id: number;
  tag_name: string;
  html_url: string;
  upload_url: string;
}

interface GitHubReleaseAsset {
  id: number;
  name: string;
  browser_download_url: string;
  content_type?: string;
  size?: number;
}

interface GitHubReleaseListItem {
  id: number;
  tag_name: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

interface ParsedGitHubSource {
  repo: string;
  tag?: string;
  assetName?: string;
}

const GITHUB_API_BASE = 'https://api.github.com';

function parseGitHubRepo(repoInput: string): { owner: string; repo: string } {
  const normalized = repoInput.trim().replace(/\.git$/i, '');

  const httpMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (httpMatch) {
    return { owner: httpMatch[1], repo: httpMatch[2] };
  }

  const shortMatch = normalized.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  throw new Error('Invalid repository format. Use owner/repo or a GitHub repository URL.');
}

function parseGitHubSourceLink(sourceInput: string): ParsedGitHubSource {
  const raw = sourceInput.trim();
  if (!raw) {
    throw new Error('Source link cannot be empty');
  }

  const normalized = raw.replace(/\.git$/i, '');

  const shortMatch = normalized.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) {
    return { repo: `${shortMatch[1]}/${shortMatch[2]}` };
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Invalid GitHub source link');
  }

  if (!/^(www\.)?github\.com$/i.test(url.hostname)) {
    throw new Error('Only github.com links are supported');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Invalid GitHub repository link');
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  const parsed: ParsedGitHubSource = { repo: `${owner}/${repo}` };

  if (parts.length >= 5 && parts[2] === 'releases' && parts[3] === 'tag') {
    parsed.tag = decodeURIComponent(parts[4]);
    return parsed;
  }

  if (parts.length >= 6 && parts[2] === 'releases' && parts[3] === 'download') {
    parsed.tag = decodeURIComponent(parts[4]);
    parsed.assetName = decodeURIComponent(parts.slice(5).join('/'));
    return parsed;
  }

  return parsed;
}

function buildGitHubJsonHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AutoInstallManager',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function readGitHubApiError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { message?: string };
    if (json?.message) {
      return json.message;
    }
  } catch {
    // Ignore JSON parse errors and fallback to plain text.
  }

  try {
    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    // Ignore text parse errors.
  }

  return `${response.status} ${response.statusText}`;
}

async function getOrCreateReleaseByTag(
  owner: string,
  repo: string,
  token: string,
  tag: string,
  releaseName?: string,
  options?: { createIfMissing?: boolean; draft?: boolean; prerelease?: boolean }
): Promise<GitHubReleaseInfo> {
  const headers = buildGitHubJsonHeaders(token);
  const getReleaseUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const getReleaseResponse = await fetch(getReleaseUrl, {
    method: 'GET',
    headers,
  });

  if (getReleaseResponse.ok) {
    return (await getReleaseResponse.json()) as GitHubReleaseInfo;
  }

  if (getReleaseResponse.status !== 404) {
    const message = await readGitHubApiError(getReleaseResponse);
    throw new Error(`Failed to fetch release for tag "${tag}": ${message}`);
  }

  if (!options?.createIfMissing) {
    throw new Error(
      `Release tag "${tag}" not found. Enable create release to create it automatically.`
    );
  }

  const createReleaseUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`;
  const createReleaseResponse = await fetch(createReleaseUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: tag,
      name: releaseName?.trim() || tag,
      draft: options.draft ?? false,
      prerelease: options.prerelease ?? false,
      generate_release_notes: true,
    }),
  });

  if (!createReleaseResponse.ok) {
    const message = await readGitHubApiError(createReleaseResponse);
    throw new Error(`Failed to create release for tag "${tag}": ${message}`);
  }

  return (await createReleaseResponse.json()) as GitHubReleaseInfo;
}

async function removeReleaseAssetIfExists(
  owner: string,
  repo: string,
  releaseId: number,
  assetName: string,
  token: string
): Promise<void> {
  const headers = buildGitHubJsonHeaders(token);
  const listAssetsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/${releaseId}/assets?per_page=100`;
  const listAssetsResponse = await fetch(listAssetsUrl, {
    method: 'GET',
    headers,
  });

  if (!listAssetsResponse.ok) {
    const message = await readGitHubApiError(listAssetsResponse);
    throw new Error(`Failed to list existing release assets: ${message}`);
  }

  const assets = (await listAssetsResponse.json()) as GitHubReleaseAsset[];
  const existingAsset = assets.find((asset) => asset.name === assetName);
  if (!existingAsset) {
    return;
  }

  const deleteAssetUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`;
  const deleteAssetResponse = await fetch(deleteAssetUrl, {
    method: 'DELETE',
    headers,
  });

  if (!deleteAssetResponse.ok) {
    const message = await readGitHubApiError(deleteAssetResponse);
    throw new Error(`Failed to delete existing release asset "${assetName}": ${message}`);
  }
}

async function uploadReleaseAsset(
  payload: ReleaseUploadRequest
): Promise<ReleaseUploadResult> {
  try {
    const repoInput = payload.repo?.trim() || '';
    const tag = payload.tag?.trim() || '';
    let token = payload.token?.trim() || '';
    const filePath = payload.filePath?.trim() || '';

    if (!repoInput) {
      throw new Error('Repository cannot be empty');
    }
    if (!tag) {
      throw new Error('Tag cannot be empty');
    }
    if (!token) {
      const credential = await getGitHubAccountCredential(payload.accountId);
      token = credential?.token || '';
    }
    if (!token) {
      throw new Error('GitHub token cannot be empty. Configure a global GitHub account in Settings.');
    }
    if (!filePath) {
      throw new Error('Asset file path cannot be empty');
    }

    const { owner, repo } = parseGitHubRepo(repoInput);
    const fileStat = await fs.stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`Selected path is not a file: ${filePath}`);
    }

    const release = await getOrCreateReleaseByTag(
      owner,
      repo,
      token,
      tag,
      payload.releaseName,
      {
        createIfMissing: payload.createReleaseIfMissing !== false,
        draft: payload.draft ?? false,
        prerelease: payload.prerelease ?? false,
      }
    );

    const assetName = path.basename(filePath);
    if (payload.overwriteAsset) {
      await removeReleaseAssetIfExists(owner, repo, release.id, assetName, token);
    }

    const uploadBaseUrl = release.upload_url.replace(/\{.*$/, '');
    const uploadUrl = `${uploadBaseUrl}?name=${encodeURIComponent(assetName)}`;
    const uploadHeaders = {
      ...buildGitHubJsonHeaders(token),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileStat.size),
    };

    const uploadInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: uploadHeaders,
      body: createReadStream(filePath) as unknown as BodyInit,
      duplex: 'half',
    };

    const uploadResponse = await fetch(uploadUrl, uploadInit);
    if (!uploadResponse.ok) {
      const message = await readGitHubApiError(uploadResponse);
      throw new Error(`Failed to upload release asset "${assetName}": ${message}`);
    }

    const asset = (await uploadResponse.json()) as GitHubReleaseAsset;
    return {
      success: true,
      releaseId: release.id,
      releaseTag: release.tag_name,
      releaseUrl: release.html_url,
      assetId: asset.id,
      assetName: asset.name,
      assetDownloadUrl: asset.browser_download_url,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Release upload failed',
    };
  }
}

const SEMVER_LIKE_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function fetchGitHubReleaseVersions(
  repoInput: string,
  token?: string
): Promise<string[]> {
  const { owner, repo } = parseGitHubRepo(repoInput);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?per_page=100`,
    {
      method: 'GET',
      headers: buildGitHubJsonHeaders(token),
    }
  );

  if (!response.ok) {
    const message = await readGitHubApiError(response);
    throw new Error(`Failed to fetch release versions: ${message}`);
  }

  const releases = (await response.json()) as Array<{ tag_name: string }>;
  const seen = new Set<string>();
  const versions: string[] = [];

  for (const release of releases) {
    const normalized = release.tag_name.replace(/^v/, '').trim();
    if (!normalized || !SEMVER_LIKE_RE.test(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    versions.push(normalized);
  }

  return versions;
}

async function fetchGitHubReleaseDetails(
  repoInput: string,
  token?: string
): Promise<GitHubReleaseListItem[]> {
  const { owner, repo } = parseGitHubRepo(repoInput);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?per_page=30`,
    {
      method: 'GET',
      headers: buildGitHubJsonHeaders(token),
    }
  );

  if (!response.ok) {
    const message = await readGitHubApiError(response);
    throw new Error(`Failed to fetch releases: ${message}`);
  }

  return (await response.json()) as GitHubReleaseListItem[];
}

async function discoverGitHubReleasesFromSource(
  payload: ReleaseDiscoverRequest
): Promise<ReleaseDiscoverResult> {
  const parsed = parseGitHubSourceLink(payload.source);
  const credential = await getGitHubAccountCredential(payload.accountId);
  const releases = await fetchGitHubReleaseDetails(parsed.repo, credential?.token);

  return {
    repo: parsed.repo,
    suggestedTag: parsed.tag,
    suggestedAssetName: parsed.assetName,
    releases: releases.map((release) => ({
      id: release.id,
      tag: release.tag_name,
      name: release.name || undefined,
      draft: Boolean(release.draft),
      prerelease: Boolean(release.prerelease),
      publishedAt: release.published_at || undefined,
      assets: (release.assets || []).map((asset) => ({
        id: asset.id,
        name: asset.name,
        downloadUrl: asset.browser_download_url,
        contentType: asset.content_type || undefined,
        size: asset.size,
      })),
    })),
  };
}

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
    const credential = await getGitHubAccountCredential(tool.auth?.githubAccountId);

    try {
      const versions = await resolver.resolve(tool.versionSource, {
        githubToken: credential?.token,
      });
      return versions.map((v) => v.version);
    } catch (resolveError) {
      if (tool.versionSource.type !== 'githubReleases') {
        throw resolveError;
      }

      if (!credential?.token) {
        throw resolveError;
      }

      return await fetchGitHubReleaseVersions(tool.versionSource.repo, credential.token);
    }
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

  ipcMain.handle('catalog:removeToolDefinition', async (_event, toolId: string) => {
    const normalizedId = typeof toolId === 'string' ? toolId.trim() : '';
    if (!normalizedId) {
      throw new Error('Tool ID cannot be empty');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(normalizedId)) {
      throw new Error('Tool ID contains invalid characters');
    }

    const catalogDir = getCatalogDir();
    const candidatePaths = [
      path.join(catalogDir, `${normalizedId}.yaml`),
      path.join(catalogDir, `${normalizedId}.yml`),
    ];

    let removed = false;
    for (const targetPath of candidatePaths) {
      try {
        await fs.rm(targetPath);
        removed = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    if (!removed) {
      throw new Error(`Tool "${normalizedId}" definition was not found in catalog.`);
    }

    await reloadCatalog();
  });

  ipcMain.handle('release:pickAssetFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: 'Select Release Asset',
      properties: ['openFile'],
      buttonLabel: 'Select',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('release:uploadAsset', async (_event, payload: ReleaseUploadRequest) => {
    return await uploadReleaseAsset(payload);
  });

  ipcMain.handle('release:discoverFromLink', async (_event, payload: ReleaseDiscoverRequest) => {
    if (!payload || typeof payload.source !== 'string') {
      throw new Error('Source link is required');
    }
    return await discoverGitHubReleasesFromSource(payload);
  });

  ipcMain.handle('githubAccount:list', async () => {
    return await listGitHubAccounts();
  });

  ipcMain.handle('githubAccount:upsert', async (_event, payload: GitHubAccountUpsertRequest) => {
    return await upsertGitHubAccount(payload);
  });

  ipcMain.handle('githubAccount:remove', async (_event, accountId: string) => {
    await removeGitHubAccount(accountId);
  });

  ipcMain.handle('githubAccount:setDefault', async (_event, accountId: string) => {
    await setDefaultGitHubAccount(accountId);
  });

  ipcMain.handle('githubAccount:getDefaultCredential', async () => {
    return await getGitHubAccountCredential();
  });

  ipcMain.handle('githubAccount:loginWithBrowser', async (_event, host?: string) => {
    return await loginGitHubAccountWithBrowser(host);
  });

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
    installer.setGitHubTokenProvider(async (tool) => {
      if (tool.versionSource.type !== 'githubReleases') {
        return undefined;
      }
      const credential = await getGitHubAccountCredential(tool.auth?.githubAccountId);
      return credential?.token;
    });

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
