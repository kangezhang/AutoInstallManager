//! Tauri command handlers — thin glue between the JS frontend and the Rust
//! modules. Every public function here is registered in `lib.rs`'s
//! `invoke_handler!`.

use crate::accounts;
use crate::catalog::{self, ToolDefinition};
use crate::dualnet;
use crate::error::{AppError, AppResult};
use crate::git_local;
use crate::github;
use crate::installer::{InstallOptions, InstallResult, InstallTask};
use crate::platform::{self, PlatformInfo};
use crate::scanner::{DetectedTool, ScanReport};
use crate::AppState;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

// ---------------------------- platform ----------------------------

#[tauri::command]
pub fn platform_get_info() -> PlatformInfo {
    platform::detect()
}

#[tauri::command]
pub fn platform_relaunch_as_admin(handle: AppHandle) -> AppResult<()> {
    platform::relaunch_as_admin()?;
    handle.exit(0);
    Ok(())
}

// ---------------------------- catalog ----------------------------

fn resolve_resource_dir(handle: &AppHandle) -> Option<std::path::PathBuf> {
    handle.path().resource_dir().ok()
}

#[tauri::command]
pub async fn catalog_load(handle: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let resource_dir = resolve_resource_dir(&handle);
    let loaded = tokio::task::spawn_blocking(move || catalog::load_catalog(resource_dir))
        .await
        .map_err(|e| AppError::Other(format!("catalog task failed: {}", e)))??;
    state.installer.set_catalog(&loaded.tools).await;
    *state.catalog.write().await = Some(loaded);
    Ok(())
}

#[tauri::command]
pub async fn catalog_list_tools(state: State<'_, AppState>) -> AppResult<Vec<ToolDefinition>> {
    let catalog = state.catalog.read().await;
    Ok(catalog
        .as_ref()
        .map(|c| c.tools.clone())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn catalog_get_tool(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<ToolDefinition>> {
    let catalog = state.catalog.read().await;
    Ok(catalog
        .as_ref()
        .and_then(|c| c.tools.iter().find(|t| t.id == id).cloned()))
}

#[tauri::command]
pub async fn catalog_get_versions(
    state: State<'_, AppState>,
    tool_id: String,
) -> AppResult<Vec<String>> {
    let tool = {
        let catalog = state.catalog.read().await;
        catalog
            .as_ref()
            .and_then(|c| c.tools.iter().find(|t| t.id == tool_id).cloned())
            .ok_or_else(|| AppError::NotFound(format!("Tool not found: {}", tool_id)))?
    };

    match tool.version_source {
        catalog::VersionSource::StaticList { versions } => Ok(versions
            .into_iter()
            .map(|v| v.trim_start_matches('v').to_string())
            .collect()),
        catalog::VersionSource::GithubReleases { repo, tag_prefix } => {
            let account_id = tool.auth.as_ref().and_then(|a| a.github_account_id.clone());
            let cred = accounts::get_credential(account_id.as_deref())?;
            github::fetch_release_versions(
                &repo,
                cred.as_ref().map(|c| c.token.as_str()),
                tag_prefix.as_deref(),
            )
            .await
        }
        catalog::VersionSource::CustomJsonFeed { .. } => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn catalog_add_tool_definition(
    handle: AppHandle,
    state: State<'_, AppState>,
    content: String,
    overwrite: Option<bool>,
) -> AppResult<ToolDefinition> {
    let tool = catalog::add_tool_definition(&content, overwrite.unwrap_or(false))?;
    catalog_load(handle, state).await?;
    Ok(tool)
}

#[tauri::command]
pub async fn catalog_remove_tool_definition(
    handle: AppHandle,
    state: State<'_, AppState>,
    tool_id: String,
) -> AppResult<()> {
    catalog::remove_tool_definition(&tool_id)?;
    catalog_load(handle, state).await
}

// ---------------------------- github accounts ----------------------------

#[tauri::command]
pub fn github_account_list() -> AppResult<accounts::AccountListResult> {
    accounts::list()
}

#[tauri::command]
pub fn github_account_upsert(
    payload: accounts::AccountUpsertRequest,
) -> AppResult<accounts::AccountSummary> {
    accounts::upsert(payload)
}

#[tauri::command]
pub fn github_account_remove(account_id: String) -> AppResult<()> {
    accounts::remove(&account_id)
}

#[tauri::command]
pub fn github_account_set_default(account_id: String) -> AppResult<()> {
    accounts::set_default(&account_id)
}

#[tauri::command]
pub fn github_account_get_default_credential() -> AppResult<Option<accounts::AccountCredential>> {
    accounts::get_credential(None)
}

#[tauri::command]
pub async fn github_account_login_with_browser(
    host: Option<String>,
) -> AppResult<accounts::AccountBrowserLoginResult> {
    accounts::login_with_browser(host).await
}

// ---------------------------- github repo ----------------------------

#[tauri::command]
pub async fn github_repo_create(payload: github::RepoCreateRequest) -> AppResult<github::RepoInfo> {
    github::create_repo(payload).await
}

#[tauri::command]
pub async fn github_repo_list_mine(
    payload: Option<github::ListMineRequest>,
) -> AppResult<Vec<github::RepoInfo>> {
    github::list_mine(payload.unwrap_or_default()).await
}

#[tauri::command]
pub async fn github_repo_get_info(
    payload: github::RepoQueryRequest,
) -> AppResult<github::RepoInfo> {
    github::get_repo(payload).await
}

#[tauri::command]
pub async fn github_repo_list_commits(
    payload: github::CommitsRequest,
) -> AppResult<Vec<github::CommitInfo>> {
    github::list_commits(payload).await
}

#[tauri::command]
pub async fn github_repo_fork(payload: github::ForkRequest) -> AppResult<github::RepoInfo> {
    github::fork_repo(payload).await
}

#[tauri::command]
pub async fn github_repo_clone(
    payload: github::CloneRequest,
) -> AppResult<github::GitOperationResult> {
    Ok(github::clone_repo(payload).await)
}

#[tauri::command]
pub async fn github_repo_create_from_folder(
    payload: github::RepoCreateFromFolderRequest,
) -> AppResult<github::RepoCreateFromFolderResult> {
    Ok(github::create_repo_from_folder(payload).await)
}

#[tauri::command]
pub async fn github_repo_upsert_file(
    payload: github::RepoUpsertFileRequest,
) -> AppResult<github::RepoUpsertFileResult> {
    Ok(github::upsert_repo_file(payload).await)
}

#[tauri::command]
pub async fn github_repo_pick_clone_dest(handle: AppHandle) -> AppResult<Option<String>> {
    pick_directory(handle, "Select Clone Destination").await
}

#[tauri::command]
pub async fn github_repo_pick_local_folder(handle: AppHandle) -> AppResult<Option<String>> {
    pick_directory(handle, "Select Local Project Folder").await
}

#[tauri::command]
pub async fn github_repo_list_forks(
    payload: github::RepoQueryRequest,
) -> AppResult<Vec<github::RepoInfo>> {
    github::list_forks(payload).await
}

// ---------------------------- pull requests ----------------------------

#[tauri::command]
pub async fn github_pr_create(
    payload: github::PullRequestCreateRequest,
) -> AppResult<github::PullRequestInfo> {
    github::create_pr(payload).await
}

#[tauri::command]
pub async fn github_pr_list(
    payload: github::PullRequestListRequest,
) -> AppResult<Vec<github::PullRequestInfo>> {
    github::list_prs(payload).await
}

// ---------------------------- release ----------------------------

#[tauri::command]
pub async fn release_pick_asset_file(handle: AppHandle) -> AppResult<Option<String>> {
    pick_file(handle, "Select Release Asset").await
}

#[tauri::command]
pub async fn release_upload_asset(
    payload: github::ReleaseUploadRequest,
) -> AppResult<github::ReleaseUploadResult> {
    Ok(github::upload_release_asset(payload).await)
}

#[tauri::command]
pub async fn release_discover_from_link(
    payload: github::ReleaseDiscoverRequest,
) -> AppResult<github::ReleaseDiscoverResult> {
    github::discover_releases(payload).await
}

// ---------------------------- installer ----------------------------

#[tauri::command]
pub async fn install_create(
    state: State<'_, AppState>,
    tool_id: String,
    version: String,
    _options: Option<InstallOptions>,
) -> AppResult<InstallTask> {
    let tool = {
        let catalog = state.catalog.read().await;
        catalog
            .as_ref()
            .and_then(|c| c.tools.iter().find(|t| t.id == tool_id).cloned())
            .ok_or_else(|| AppError::NotFound(format!("Tool not found: {}", tool_id)))?
    };
    Ok(state.installer.create_task(&tool, &version, "install"))
}

#[tauri::command]
pub async fn install_start(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<InstallResult> {
    let task = state
        .installer
        .get_task(&task_id)
        .ok_or_else(|| AppError::NotFound(format!("Task not found: {}", task_id)))?;
    let tool = {
        let catalog = state.catalog.read().await;
        catalog
            .as_ref()
            .and_then(|c| c.tools.iter().find(|t| t.id == task.tool_id).cloned())
            .ok_or_else(|| AppError::NotFound(format!("Tool not found: {}", task.tool_id)))?
    };
    Ok(state
        .installer
        .install(
            tool,
            InstallOptions {
                version: Some(task.version.clone()),
                target_dir: None,
                force: Some(true),
            },
            task_id,
        )
        .await)
}

#[tauri::command]
pub fn install_cancel(state: State<'_, AppState>, task_id: String) -> AppResult<bool> {
    Ok(state.installer.cancel(&task_id))
}

#[tauri::command]
pub async fn install_rollback(
    state: State<'_, AppState>,
    tool_id: String,
) -> AppResult<InstallResult> {
    Ok(state.installer.rollback(&tool_id).await)
}

#[tauri::command]
pub async fn install_uninstall(
    state: State<'_, AppState>,
    tool_id: String,
) -> AppResult<InstallResult> {
    Ok(state.installer.uninstall(&tool_id).await)
}

#[tauri::command]
pub fn install_status(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<Option<InstallTask>> {
    Ok(state.installer.get_task(&task_id))
}

#[tauri::command]
pub async fn install_list(state: State<'_, AppState>) -> AppResult<Vec<InstallTask>> {
    Ok(state.installer.list_tasks().await)
}

// ---------------------------- scanner ----------------------------

#[tauri::command]
pub async fn scan_start(state: State<'_, AppState>) -> AppResult<Option<ScanReport>> {
    let tools = {
        let catalog = state.catalog.read().await;
        catalog
            .as_ref()
            .map(|c| c.tools.clone())
            .unwrap_or_default()
    };
    if tools.is_empty() {
        return Ok(None);
    }
    let report = state.scanner.scan_all(&tools, &state.installer).await;
    Ok(Some(report))
}

#[tauri::command]
pub async fn scan_tool(state: State<'_, AppState>, tool_id: String) -> AppResult<DetectedTool> {
    let tool = {
        let catalog = state.catalog.read().await;
        catalog
            .as_ref()
            .and_then(|c| c.tools.iter().find(|t| t.id == tool_id).cloned())
            .ok_or_else(|| AppError::NotFound(format!("Tool not found: {}", tool_id)))?
    };
    Ok(state.scanner.scan_one(&tool).await)
}

#[tauri::command]
pub fn scan_get_report(state: State<'_, AppState>) -> AppResult<Option<ScanReport>> {
    Ok(state.scanner.last_report())
}

// ---------------------------- dualnet bridge ----------------------------

#[tauri::command]
pub async fn dualnet_scan_adapters() -> AppResult<dualnet::DualNetScanReport> {
    tokio::task::spawn_blocking(dualnet::scan)
        .await
        .map_err(|e| AppError::Other(format!("dualnet scan task failed: {}", e)))?
}

#[tauri::command]
pub async fn dualnet_client_apply_ip_preset(
    payload: dualnet::ClientIpModeRequest,
) -> AppResult<dualnet::ClientIpModeResult> {
    tokio::task::spawn_blocking(move || dualnet::apply_client_ip_preset(payload))
        .await
        .map_err(|e| AppError::Other(format!("dualnet client ip preset task failed: {}", e)))?
}

#[tauri::command]
pub async fn dualnet_client_restore_dhcp(
    payload: dualnet::ClientIpModeRequest,
) -> AppResult<dualnet::ClientIpModeResult> {
    tokio::task::spawn_blocking(move || dualnet::restore_client_dhcp(payload))
        .await
        .map_err(|e| AppError::Other(format!("dualnet client dhcp task failed: {}", e)))?
}

// ---------------------------- helpers ----------------------------

async fn pick_directory(handle: AppHandle, title: &str) -> AppResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();
    handle
        .dialog()
        .file()
        .set_title(title)
        .pick_folder(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });
    let result = rx
        .await
        .map_err(|e| AppError::Other(format!("dialog channel: {}", e)))?;
    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

async fn pick_file(handle: AppHandle, title: &str) -> AppResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();
    handle
        .dialog()
        .file()
        .set_title(title)
        .pick_file(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });
    let result = rx
        .await
        .map_err(|e| AppError::Other(format!("dialog channel: {}", e)))?;
    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

// ---------------------------- git local ----------------------------

#[tauri::command]
pub fn git_local_list(state: State<'_, AppState>) -> AppResult<Vec<git_local::LocalRepoEntry>> {
    Ok(state.git_registry.list())
}

#[tauri::command]
pub async fn git_local_pick_and_add(
    handle: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<git_local::LocalRepoEntry>> {
    let picked = pick_directory(handle, "Open local Git repository").await?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let registry = state.git_registry.clone();
    let entry = tokio::task::spawn_blocking(move || registry.add(std::path::PathBuf::from(path)))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))??;
    Ok(Some(entry))
}

#[tauri::command]
pub async fn git_local_add_path(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<git_local::LocalRepoEntry> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || registry.add(std::path::PathBuf::from(path)))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub fn git_local_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.git_registry.remove(&id)
}

#[tauri::command]
pub fn git_local_set_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<()> {
    state.git_registry.set_favorite(&id, favorite)
}

#[tauri::command]
pub fn git_local_rename(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    state.git_registry.rename(&id, name)
}

#[tauri::command]
pub async fn git_local_summary(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<git_local::LocalRepoSummary> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::summary(&registry, &id))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_status(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<git_local::LocalStatus> {
    let registry = state.git_registry.clone();
    let id_for_touch = id.clone();
    tokio::task::spawn_blocking(move || {
        let _ = registry.touch(&id_for_touch);
        git_local::status(&registry, &id)
    })
    .await
    .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_log(
    state: State<'_, AppState>,
    id: String,
    branch: Option<String>,
    limit: Option<usize>,
) -> AppResult<Vec<git_local::LocalCommit>> {
    let registry = state.git_registry.clone();
    let limit = limit.unwrap_or(200);
    tokio::task::spawn_blocking(move || git_local::log(&registry, &id, branch, limit))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_branches(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<git_local::LocalBranch>> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::branches(&registry, &id))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_remotes(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<git_local::LocalRemote>> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::remotes(&registry, &id))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_tags(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<git_local::LocalTag>> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::tags(&registry, &id))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_diff(
    state: State<'_, AppState>,
    id: String,
    path: String,
    staged: bool,
) -> AppResult<String> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::diff_text(&registry, &id, &path, staged))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_stage(
    state: State<'_, AppState>,
    id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::stage_paths(&registry, &id, paths))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_stage_all(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::stage_all(&registry, &id))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_untrack_ignored(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<git_local::UntrackIgnoredResult> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::untrack_ignored(&registry, &id))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_unstage(
    state: State<'_, AppState>,
    id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::unstage_paths(&registry, &id, paths))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_discard(
    state: State<'_, AppState>,
    id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::discard_paths(&registry, &id, paths))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_commit(
    state: State<'_, AppState>,
    id: String,
    options: git_local::CommitOptions,
) -> AppResult<git_local::CommitResult> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || git_local::commit(&registry, &id, options))
        .await
        .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_push(
    state: State<'_, AppState>,
    id: String,
    remote: Option<String>,
    branch: Option<String>,
    force: Option<bool>,
) -> AppResult<git_local::PushResult> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || {
        git_local::push(
            &registry,
            &id,
            remote.as_deref(),
            branch.as_deref(),
            force.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("task: {}", e)))?
}

#[tauri::command]
pub async fn git_local_pull(
    state: State<'_, AppState>,
    id: String,
    remote: Option<String>,
    branch: Option<String>,
    rebase: Option<bool>,
) -> AppResult<git_local::PushResult> {
    let registry = state.git_registry.clone();
    tokio::task::spawn_blocking(move || {
        git_local::pull(
            &registry,
            &id,
            remote.as_deref(),
            branch.as_deref(),
            rebase.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("task: {}", e)))?
}
