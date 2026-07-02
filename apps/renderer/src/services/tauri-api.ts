/**
 * Tauri ⇄ React bridge.
 *
 * Provides a shim that mirrors the old `window.electronAPI` shape so existing
 * pages keep working while we incrementally migrate to direct invoke calls.
 *
 * The shim translates camelCase JS payloads into the snake_case command
 * arguments Tauri expects (Tauri auto-camels parameter names, but our payload
 * keys go through `serde(rename_all = "camelCase")` on the Rust side).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

type Json = Record<string, unknown>;

const call = <T>(cmd: string, args?: Json): Promise<T> =>
  invoke<T>(cmd, args ?? {});

// ---------- Platform ----------
export const platform = {
  getInfo: () => call<unknown>('platform_get_info'),
};

// ---------- Catalog ----------
export const catalog = {
  load: () => call<void>('catalog_load'),
  getTool: (id: string) => call<unknown>('catalog_get_tool', { id }),
  listTools: () => call<unknown[]>('catalog_list_tools'),
  getVersions: (toolId: string) =>
    call<string[]>('catalog_get_versions', { toolId }),
  addToolDefinition: (content: string, options?: { overwrite?: boolean }) =>
    call<unknown>('catalog_add_tool_definition', {
      content,
      overwrite: options?.overwrite ?? false,
    }),
  removeToolDefinition: (toolId: string) =>
    call<void>('catalog_remove_tool_definition', { toolId }),
};

// ---------- Scanner ----------
export const scanner = {
  start: () => call<unknown>('scan_start'),
  scanTool: (toolId: string) => call<unknown>('scan_tool', { toolId }),
  getReport: () => call<unknown>('scan_get_report'),
};

// ---------- DualNet Bridge ----------
export const dualnet = {
  scanAdapters: () => call<unknown>('dualnet_scan_adapters'),
  clientApplyIpPreset: (interfaceIndex: number) =>
    call<unknown>('dualnet_client_apply_ip_preset', {
      payload: { interfaceIndex },
    }),
  clientRestoreDhcp: (interfaceIndex: number) =>
    call<unknown>('dualnet_client_restore_dhcp', {
      payload: { interfaceIndex },
    }),
};

// ---------- Installer ----------
export const installer = {
  createTask: (toolId: string, version: string, options?: Json) =>
    call<unknown>('install_create', { toolId, version, options }),
  start: (taskId: string) => call<unknown>('install_start', { taskId }),
  cancel: (taskId: string) => call<boolean>('install_cancel', { taskId }),
  rollback: (toolId: string) => call<unknown>('install_rollback', { toolId }),
  uninstall: (toolId: string) => call<unknown>('install_uninstall', { toolId }),
  getStatus: (taskId: string) => call<unknown>('install_status', { taskId }),
  listTasks: () => call<unknown[]>('install_list'),
};

// ---------- Release ----------
export const release = {
  pickAssetFile: () => call<string | null>('release_pick_asset_file'),
  uploadAsset: (payload: Json) =>
    call<unknown>('release_upload_asset', { payload }),
  discoverFromLink: (payload: Json) =>
    call<unknown>('release_discover_from_link', { payload }),
};

// ---------- GitHub Account ----------
export const githubAccount = {
  list: () => call<unknown>('github_account_list'),
  upsert: (payload: Json) => call<unknown>('github_account_upsert', { payload }),
  remove: (accountId: string) =>
    call<void>('github_account_remove', { accountId }),
  setDefault: (accountId: string) =>
    call<void>('github_account_set_default', { accountId }),
  getDefaultCredential: () =>
    call<unknown>('github_account_get_default_credential'),
  loginWithBrowser: (host?: string) =>
    call<unknown>('github_account_login_with_browser', { host }),
};

// ---------- GitHub Repo ----------
export const githubRepo = {
  create: (payload: Json) => call<unknown>('github_repo_create', { payload }),
  listMine: (payload?: Json) =>
    call<unknown[]>('github_repo_list_mine', { payload: payload ?? null }),
  getInfo: (payload: Json) => call<unknown>('github_repo_get_info', { payload }),
  listCommits: (payload: Json) =>
    call<unknown[]>('github_repo_list_commits', { payload }),
  fork: (payload: Json) => call<unknown>('github_repo_fork', { payload }),
  clone: (payload: Json) => call<unknown>('github_repo_clone', { payload }),
  createFromFolder: (payload: Json) =>
    call<unknown>('github_repo_create_from_folder', { payload }),
  upsertFile: (payload: Json) =>
    call<unknown>('github_repo_upsert_file', { payload }),
  pickCloneDest: () => call<string | null>('github_repo_pick_clone_dest'),
  pickLocalFolder: () => call<string | null>('github_repo_pick_local_folder'),
  listForks: (payload: Json) =>
    call<unknown[]>('github_repo_list_forks', { payload }),
};

// ---------- Pull Requests ----------
export const githubPR = {
  create: (payload: Json) => call<unknown>('github_pr_create', { payload }),
  list: (payload: Json) => call<unknown[]>('github_pr_list', { payload }),
};

// ---------- Local Git client ----------
export const gitLocal = {
  list: () => call<unknown[]>('git_local_list'),
  pickAndAdd: () => call<unknown | null>('git_local_pick_and_add'),
  addPath: (path: string) => call<unknown>('git_local_add_path', { path }),
  remove: (id: string) => call<void>('git_local_remove', { id }),
  setFavorite: (id: string, favorite: boolean) =>
    call<void>('git_local_set_favorite', { id, favorite }),
  rename: (id: string, name: string) =>
    call<void>('git_local_rename', { id, name }),
  summary: (id: string) => call<unknown>('git_local_summary', { id }),
  status: (id: string) => call<unknown>('git_local_status', { id }),
  log: (id: string, opts?: { branch?: string; limit?: number }) =>
    call<unknown[]>('git_local_log', {
      id,
      branch: opts?.branch ?? null,
      limit: opts?.limit ?? null,
    }),
  branches: (id: string) => call<unknown[]>('git_local_branches', { id }),
  remotes: (id: string) => call<unknown[]>('git_local_remotes', { id }),
  tags: (id: string) => call<unknown[]>('git_local_tags', { id }),
  diff: (id: string, path: string, staged: boolean) =>
    call<string>('git_local_diff', { id, path, staged }),
  stage: (id: string, paths: string[]) =>
    call<void>('git_local_stage', { id, paths }),
  stageAll: (id: string) => call<void>('git_local_stage_all', { id }),
  untrackIgnored: (id: string) =>
    call<{ removed: number; paths: string[]; addedIgnores: string[] }>(
      'git_local_untrack_ignored',
      { id }
    ),
  unstage: (id: string, paths: string[]) =>
    call<void>('git_local_unstage', { id, paths }),
  discard: (id: string, paths: string[]) =>
    call<void>('git_local_discard', { id, paths }),
  commit: (id: string, options: Json) =>
    call<unknown>('git_local_commit', { id, options }),
  push: (id: string, opts?: { remote?: string; branch?: string; force?: boolean }) =>
    call<{ success: boolean; output: string; error?: string }>('git_local_push', {
      id,
      remote: opts?.remote ?? null,
      branch: opts?.branch ?? null,
      force: opts?.force ?? false,
    }),
  pull: (id: string, opts?: { remote?: string; branch?: string; rebase?: boolean }) =>
    call<{ success: boolean; output: string; error?: string }>('git_local_pull', {
      id,
      remote: opts?.remote ?? null,
      branch: opts?.branch ?? null,
      rebase: opts?.rebase ?? false,
    }),
};

// ---------- Events ----------
type Listener<T> = (payload: T) => void;

const subscribe = <T>(name: string, cb: Listener<T>): (() => void) => {
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen<T>(name, (event) => cb(event.payload)).then((fn) => {
    if (cancelled) {
      fn();
    } else {
      unlisten = fn;
    }
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
};

export const events = {
  onInstallProgress: (cb: Listener<unknown>) =>
    subscribe('event:installProgress', cb),
  onDownloadProgress: (cb: Listener<unknown>) =>
    subscribe('event:downloadProgress', cb),
  onUploadProgress: (cb: Listener<unknown>) =>
    subscribe('event:uploadProgress', cb),
  onScanComplete: (cb: Listener<unknown>) =>
    subscribe('event:scanComplete', cb),
};

export const tauriApi = {
  platform,
  catalog,
  scanner,
  dualnet,
  installer,
  release,
  githubAccount,
  githubRepo,
  githubPR,
  gitLocal,
  events,
};

export type TauriApi = typeof tauriApi;

/**
 * Install the shim onto `window.electronAPI`. Call once during app bootstrap.
 * Existing pages can keep using `window.electronAPI.foo.bar()` unchanged.
 */
export function installTauriBridge() {
  if (typeof window === 'undefined') return;
  // Only install if Tauri is the runtime — in browser dev (no Tauri),
  // leave the field undefined so pages can show a graceful message.
  // The presence of __TAURI_INTERNALS__ is the lightweight runtime hint.
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  if (!tauri) {
    console.warn('Tauri runtime not detected — electronAPI shim not installed.');
    return;
  }
  (window as unknown as { electronAPI: TauriApi }).electronAPI = tauriApi;
}
