//! Installer: resolves versions, downloads, extracts/installs, validates, and
//! supports rollback/uninstall. Mirrors the TypeScript Installer's lifecycle.
//!
//! Currently implements the archive (zip / tar.gz) install path completely.
//! MSI/EXE/PKG/DMG branches still call platform-specific shells and are
//! marked TODO; the existing `validate` step keeps them honest.

use crate::accounts;
use crate::catalog::{Asset, ToolDefinition, VersionSource};
use crate::error::{AppError, AppResult};
use crate::github;
use crate::paths;
use crate::platform;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub task_id: String,
    pub status: String,
    pub message: String,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub task_id: String,
    pub bytes: u64,
    pub total: Option<u64>,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallTask {
    pub id: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub tool_id: String,
    pub tool_name: String,
    pub version: String,
    pub status: String,
    pub progress: TaskProgress,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub rollback_available: bool,
    #[serde(default)]
    pub logs: Vec<TaskLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub status: String,
    pub message: String,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLog {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledToolState {
    pub tool_id: String,
    pub tool_name: String,
    pub version: String,
    pub installed_path: String,
    pub asset_type: String,
    pub installed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback: Option<RollbackSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_installed_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct InstallStateFile {
    tools: HashMap<String, InstalledToolState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallOptions {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub target_dir: Option<String>,
    #[serde(default)]
    pub force: Option<bool>,
}

pub struct Installer {
    tasks: Mutex<HashMap<String, InstallTask>>,
    state: RwLock<InstallStateFile>,
    catalog_tools: RwLock<HashMap<String, ToolDefinition>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl Default for Installer {
    fn default() -> Self {
        let state = load_state_file();
        Self {
            tasks: Mutex::new(HashMap::new()),
            state: RwLock::new(state),
            catalog_tools: RwLock::new(HashMap::new()),
            app_handle: Mutex::new(None),
        }
    }
}

fn load_state_file() -> InstallStateFile {
    let path = paths::install_state_path();
    if !path.exists() {
        return InstallStateFile::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_state_file(state: &InstallStateFile) -> AppResult<()> {
    let path = paths::install_state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(state)?)?;
    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

impl Installer {
    pub fn set_app_handle(self: &Arc<Self>, handle: tauri::AppHandle) {
        *self.app_handle.lock().unwrap() = Some(handle);
    }

    pub async fn set_catalog(&self, tools: &[ToolDefinition]) {
        let mut map = self.catalog_tools.write().await;
        map.clear();
        for tool in tools {
            map.insert(tool.id.clone(), tool.clone());
        }
    }

    pub fn create_task(&self, tool: &ToolDefinition, version: &str, task_type: &str) -> InstallTask {
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_iso();
        let task = InstallTask {
            id: id.clone(),
            task_type: task_type.to_string(),
            tool_id: tool.id.clone(),
            tool_name: tool.name.clone(),
            version: version.to_string(),
            status: "pending".into(),
            progress: TaskProgress {
                status: "pending".into(),
                message: "Waiting to start".into(),
                percent: 0.0,
            },
            created_at: created_at.clone(),
            started_at: None,
            completed_at: None,
            installed_path: None,
            error: None,
            rollback_available: false,
            logs: vec![TaskLog {
                timestamp: created_at,
                level: "info".into(),
                message: format!("Task created ({})", task_type),
            }],
        };
        self.tasks.lock().unwrap().insert(id.clone(), task.clone());
        task
    }

    pub fn get_task(&self, task_id: &str) -> Option<InstallTask> {
        self.tasks.lock().unwrap().get(task_id).cloned()
    }

    pub async fn list_tasks(&self) -> Vec<InstallTask> {
        let mut tasks: Vec<InstallTask> =
            self.tasks.lock().unwrap().values().cloned().collect();
        let state = self.state.read().await;
        let known_tool_ids: std::collections::HashSet<String> = tasks
            .iter()
            .filter(|t| t.status == "installed" || t.status == "rolled-back")
            .map(|t| t.tool_id.clone())
            .collect();
        for record in state.tools.values() {
            if known_tool_ids.contains(&record.tool_id) {
                continue;
            }
            tasks.push(InstallTask {
                id: format!("state-{}", record.tool_id),
                task_type: "install".into(),
                tool_id: record.tool_id.clone(),
                tool_name: record.tool_name.clone(),
                version: record.version.clone(),
                status: "installed".into(),
                progress: TaskProgress {
                    status: "installed".into(),
                    message: "Installed".into(),
                    percent: 100.0,
                },
                created_at: record.installed_at.clone(),
                started_at: None,
                completed_at: Some(record.installed_at.clone()),
                installed_path: Some(record.installed_path.clone()),
                error: None,
                rollback_available: record
                    .rollback
                    .as_ref()
                    .map(|r| r.backup_path.is_some() || r.previous_installed_path.is_some())
                    .unwrap_or(false),
                logs: vec![TaskLog {
                    timestamp: record.installed_at.clone(),
                    level: "info".into(),
                    message: "Loaded from installed state".into(),
                }],
            });
        }
        tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        tasks
    }

    fn update_task(&self, task_id: &str, status: &str, message: &str, percent: f32) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = status.to_string();
            task.progress = TaskProgress {
                status: status.into(),
                message: message.into(),
                percent,
            };
            task.logs.push(TaskLog {
                timestamp: now_iso(),
                level: "info".into(),
                message: format!("[{}] {} ({:.0}%)", status, message, percent),
            });
        }
        if let Some(handle) = self.app_handle.lock().unwrap().as_ref() {
            let _ = handle.emit(
                "event:installProgress",
                InstallProgress {
                    task_id: task_id.into(),
                    status: status.into(),
                    message: message.into(),
                    percent,
                },
            );
        }
    }

    fn fail_task(&self, task_id: &str, error: &str) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = "failed".into();
            task.error = Some(error.to_string());
            task.completed_at = Some(now_iso());
            task.progress = TaskProgress {
                status: "failed".into(),
                message: format!("Installation failed: {}", error),
                percent: 0.0,
            };
            task.logs.push(TaskLog {
                timestamp: now_iso(),
                level: "error".into(),
                message: error.to_string(),
            });
        }
    }

    fn complete_task(
        &self,
        task_id: &str,
        version: &str,
        installed_path: &str,
        rollback_available: bool,
    ) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = "installed".into();
            task.version = version.to_string();
            task.installed_path = Some(installed_path.to_string());
            task.rollback_available = rollback_available;
            task.completed_at = Some(now_iso());
            task.progress = TaskProgress {
                status: "installed".into(),
                message: "Installation completed".into(),
                percent: 100.0,
            };
        }
    }

    pub async fn install(
        self: &Arc<Self>,
        tool: ToolDefinition,
        options: InstallOptions,
        task_id: String,
    ) -> InstallResult {
        let result = self.install_inner(tool, options, &task_id).await;
        match &result {
            Ok(r) => {
                if r.success {
                    if let (Some(v), Some(p)) = (r.version.as_deref(), r.installed_path.as_deref()) {
                        self.complete_task(&task_id, v, p, true);
                    }
                } else if let Some(err) = r.error.as_deref() {
                    self.fail_task(&task_id, err);
                }
            }
            Err(e) => self.fail_task(&task_id, &e.to_string()),
        }
        result.unwrap_or_else(|e| InstallResult {
            success: false,
            version: None,
            installed_path: None,
            error: Some(e.to_string()),
        })
    }

    async fn install_inner(
        self: &Arc<Self>,
        tool: ToolDefinition,
        options: InstallOptions,
        task_id: &str,
    ) -> AppResult<InstallResult> {
        self.update_task(task_id, "pending", "Resolving version...", 5.0);
        let target_version = self.resolve_target_version(&tool, options.version.as_deref()).await?;
        self.update_task(
            task_id,
            "pending",
            &format!("Resolved version {}", target_version.version),
            8.0,
        );

        let asset = select_asset(&tool)?;
        let target_dir = resolve_target_dir(&tool, &target_version.version, options.target_dir.as_deref());
        self.update_task(task_id, "pending", "Preparing target directory...", 10.0);
        let backup_path = prepare_target_dir(&target_dir, options.force.unwrap_or(false))?;

        self.update_task(task_id, "downloading", "Downloading...", 12.0);
        let download_url = render_template(&asset.url, &target_version.version, target_version.tag.as_deref());
        let token = resolve_tool_token(&tool).await?;
        let temp = std::env::temp_dir().join("autoinstall").join(task_id);
        fs::create_dir_all(&temp)?;
        let file_name = file_name_from_url(&download_url, &asset.url);
        let download_path = temp.join(&file_name);

        let me = self.clone();
        let task_id_owned = task_id.to_string();
        download_with_progress(
            &download_url,
            token.as_deref(),
            asset.sha256.as_deref(),
            &download_path,
            move |bytes, total| {
                let percent = if let Some(t) = total {
                    if t > 0 { 12.0 + (bytes as f32 / t as f32) * 60.0 } else { 12.0 }
                } else {
                    12.0
                };
                me.update_task(&task_id_owned, "downloading", "Downloading...", percent);
                if let Some(handle) = me.app_handle.lock().unwrap().as_ref() {
                    let _ = handle.emit(
                        "event:downloadProgress",
                        DownloadProgress {
                            task_id: task_id_owned.clone(),
                            bytes,
                            total,
                            percent,
                        },
                    );
                }
            },
        )
        .await?;

        self.update_task(task_id, "installing", "Installing...", 75.0);
        let installed_path = perform_install(&asset, &download_path, &target_dir).await?;
        self.update_task(task_id, "installing", "Validating installation...", 90.0);
        validate_install(&tool, &target_version.version, &installed_path).await?;

        let mut state = self.state.write().await;
        let previous = state.tools.get(&tool.id).cloned();
        let rollback = build_rollback_snapshot(previous.as_ref(), backup_path.as_deref());
        state.tools.insert(
            tool.id.clone(),
            InstalledToolState {
                tool_id: tool.id.clone(),
                tool_name: tool.name.clone(),
                version: target_version.version.clone(),
                installed_path: installed_path.to_string_lossy().to_string(),
                asset_type: asset.asset_type.clone(),
                installed_at: now_iso(),
                rollback,
            },
        );
        save_state_file(&state)?;
        let _ = std::fs::remove_dir_all(&temp);

        Ok(InstallResult {
            success: true,
            version: Some(target_version.version),
            installed_path: Some(installed_path.to_string_lossy().to_string()),
            error: None,
        })
    }

    pub async fn uninstall(&self, tool_id: &str) -> InstallResult {
        let mut state = self.state.write().await;
        let Some(record) = state.tools.remove(tool_id) else {
            return InstallResult {
                success: false,
                version: None,
                installed_path: None,
                error: Some(format!("No install record found for {}", tool_id)),
            };
        };
        if !record.installed_path.is_empty() {
            let path = PathBuf::from(&record.installed_path);
            if path.exists() {
                let _ = std::fs::remove_dir_all(&path);
            }
        }
        if let Some(rb) = record.rollback.as_ref() {
            if let Some(bp) = rb.backup_path.as_deref() {
                let _ = std::fs::remove_dir_all(bp);
            }
        }
        let _ = save_state_file(&state);
        InstallResult {
            success: true,
            version: Some(record.version),
            installed_path: Some(record.installed_path),
            error: None,
        }
    }

    pub async fn rollback(&self, tool_id: &str) -> InstallResult {
        let mut state = self.state.write().await;
        let Some(record) = state.tools.get(tool_id).cloned() else {
            return InstallResult {
                success: false,
                version: None,
                installed_path: None,
                error: Some(format!("No install record found for {}", tool_id)),
            };
        };
        let Some(snap) = record.rollback.as_ref() else {
            return InstallResult {
                success: false,
                version: None,
                installed_path: None,
                error: Some("No rollback snapshot available".into()),
            };
        };
        let installed = PathBuf::from(&record.installed_path);
        let mut restored_path = installed.clone();
        let mut restored_version = record.version.clone();

        if let Some(bp) = snap.backup_path.as_deref() {
            let bp = PathBuf::from(bp);
            if bp.exists() {
                if installed.exists() {
                    let _ = std::fs::remove_dir_all(&installed);
                }
                if let Err(e) = std::fs::rename(&bp, &installed) {
                    return InstallResult {
                        success: false,
                        version: None,
                        installed_path: None,
                        error: Some(e.to_string()),
                    };
                }
            }
        } else if let Some(prev_path) = snap.previous_installed_path.as_deref() {
            let prev = PathBuf::from(prev_path);
            if prev.exists() {
                restored_path = prev;
                if let Some(prev_version) = snap.previous_version.as_deref() {
                    restored_version = prev_version.to_string();
                }
            }
        } else {
            return InstallResult {
                success: false,
                version: None,
                installed_path: None,
                error: Some("Rollback snapshot not found on disk".into()),
            };
        }

        let mut updated = record.clone();
        updated.installed_path = restored_path.to_string_lossy().to_string();
        updated.version = restored_version.clone();
        updated.rollback = None;
        updated.installed_at = now_iso();
        state.tools.insert(tool_id.to_string(), updated);
        let _ = save_state_file(&state);

        InstallResult {
            success: true,
            version: Some(restored_version),
            installed_path: Some(restored_path.to_string_lossy().to_string()),
            error: None,
        }
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(task_id) {
            if matches!(task.status.as_str(), "pending" | "downloading") {
                task.status = "cancelled".into();
                task.completed_at = Some(now_iso());
                task.progress = TaskProgress {
                    status: "cancelled".into(),
                    message: "Task cancelled".into(),
                    percent: 0.0,
                };
                return true;
            }
        }
        false
    }

    async fn resolve_target_version(
        &self,
        tool: &ToolDefinition,
        requested: Option<&str>,
    ) -> AppResult<VersionResolved> {
        let requested = requested.unwrap_or("latest").trim();
        match &tool.version_source {
            VersionSource::StaticList { versions } => {
                if requested == "latest" {
                    let v = versions
                        .first()
                        .ok_or_else(|| AppError::Install("No versions available".into()))?;
                    return Ok(VersionResolved {
                        version: v.trim_start_matches('v').to_string(),
                        tag: Some(v.clone()),
                    });
                }
                let target = requested.trim_start_matches('v').to_string();
                let matched = versions.iter().any(|v| v.trim_start_matches('v') == target);
                if !matched {
                    return Err(AppError::Install(format!(
                        "Requested version {} is not available for {}",
                        requested, tool.id
                    )));
                }
                Ok(VersionResolved {
                    version: target,
                    tag: Some(requested.to_string()),
                })
            }
            VersionSource::GithubReleases { repo, tag_prefix } => {
                let token = resolve_tool_token(tool).await?;
                let versions = github::fetch_release_versions(
                    repo,
                    token.as_deref(),
                    tag_prefix.as_deref(),
                )
                .await?;
                if requested == "latest" {
                    let v = versions
                        .first()
                        .ok_or_else(|| AppError::Install("No stable versions available".into()))?;
                    let tag = match tag_prefix.as_deref() {
                        Some(p) => format!("{}{}", p, v),
                        None => format!("v{}", v),
                    };
                    return Ok(VersionResolved {
                        version: v.clone(),
                        tag: Some(tag),
                    });
                }
                let normalized = requested.trim_start_matches('v').to_string();
                if !versions.iter().any(|v| v == &normalized) {
                    return Err(AppError::Install(format!(
                        "Requested version {} is not available for {}",
                        requested, tool.id
                    )));
                }
                let tag = match tag_prefix.as_deref() {
                    Some(p) => format!("{}{}", p, normalized),
                    None => format!("v{}", normalized),
                };
                Ok(VersionResolved {
                    version: normalized,
                    tag: Some(tag),
                })
            }
            VersionSource::CustomJsonFeed { .. } => Err(AppError::Install(
                "customJsonFeed version source is not yet implemented".into(),
            )),
        }
    }
}

struct VersionResolved {
    version: String,
    tag: Option<String>,
}

async fn resolve_tool_token(tool: &ToolDefinition) -> AppResult<Option<String>> {
    let account_id = tool
        .auth
        .as_ref()
        .and_then(|a| a.github_account_id.clone());
    let cred = accounts::get_credential(account_id.as_deref())?;
    Ok(cred.map(|c| c.token))
}

fn select_asset(tool: &ToolDefinition) -> AppResult<Asset> {
    let info = platform::detect();
    tool.assets
        .iter()
        .find(|a| a.platform == info.os && a.arch == info.arch)
        .cloned()
        .ok_or_else(|| {
            AppError::Install(format!("No asset found for {}-{}", info.os, info.arch))
        })
}

fn render_template(template: &str, version: &str, tag: Option<&str>) -> String {
    let resolved_tag = tag.unwrap_or(version);
    template
        .replace("{version}", version)
        .replace("${version}", version)
        .replace("{tag}", resolved_tag)
        .replace("${tag}", resolved_tag)
}

fn resolve_target_dir(tool: &ToolDefinition, version: &str, explicit: Option<&str>) -> PathBuf {
    let info = platform::detect();
    let template = explicit
        .map(|s| s.to_string())
        .or_else(|| tool.install.target_dir.clone())
        .unwrap_or_else(|| "{managed}/{toolId}/{version}".to_string());
    let rendered = template
        .replace("{managed}", &info.paths.managed)
        .replace("{toolId}", &tool.id)
        .replace("{version}", version)
        .replace(
            "{LOCALAPPDATA}",
            &dirs::data_local_dir()
                .unwrap_or_else(|| std::env::temp_dir())
                .to_string_lossy(),
        );
    PathBuf::from(rendered)
}

fn prepare_target_dir(target: &Path, force: bool) -> AppResult<Option<PathBuf>> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    if !target.exists() {
        return Ok(None);
    }
    if !force {
        return Err(AppError::Install(format!(
            "Target already exists: {}. Re-run with force to replace.",
            target.display()
        )));
    }
    let backup = target.with_file_name(format!(
        "{}.backup-{}",
        target
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "install".into()),
        chrono::Utc::now().timestamp_millis()
    ));
    fs::rename(target, &backup)?;
    Ok(Some(backup))
}

fn build_rollback_snapshot(
    previous: Option<&InstalledToolState>,
    backup_path: Option<&Path>,
) -> Option<RollbackSnapshot> {
    let backup = backup_path.map(|p| p.to_string_lossy().to_string());
    match (previous, backup.as_ref()) {
        (Some(prev), _) => Some(RollbackSnapshot {
            backup_path: backup,
            previous_version: Some(prev.version.clone()),
            previous_installed_path: Some(prev.installed_path.clone()),
            created_at: now_iso(),
        }),
        (None, Some(_)) => Some(RollbackSnapshot {
            backup_path: backup,
            previous_version: None,
            previous_installed_path: None,
            created_at: now_iso(),
        }),
        _ => None,
    }
}

fn file_name_from_url(resolved: &str, original: &str) -> String {
    fn from(url: &str) -> Option<String> {
        let parsed = url::Url::parse(url).ok()?;
        parsed
            .path_segments()
            .and_then(|mut s| s.next_back().map(str::to_string))
            .filter(|s| !s.is_empty())
    }
    from(original).or_else(|| from(resolved)).unwrap_or_else(|| "download".into())
}

async fn download_with_progress<F>(
    url: &str,
    github_token: Option<&str>,
    sha256: Option<&str>,
    dest: &Path,
    mut on_progress: F,
) -> AppResult<()>
where
    F: FnMut(u64, Option<u64>) + Send + 'static,
{
    use futures::StreamExt;
    let mut req = github::http().get(url);
    if let Some(token) = github_token {
        if url.contains("github.com") || url.contains("api.github.com") {
            req = req.bearer_auth(token);
        }
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "Download failed: HTTP {}",
            resp.status()
        )));
    }
    let total = resp.content_length();
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::File::create(dest)?;
    let mut hasher = sha256.is_some().then(<sha2::Sha256 as sha2::Digest>::new);
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded += chunk.len() as u64;
        if let Some(h) = hasher.as_mut() {
            sha2::Digest::update(h, &chunk);
        }
        file.write_all(&chunk)?;
        on_progress(downloaded, total);
    }
    file.flush()?;
    if let (Some(expected), Some(h)) = (sha256, hasher) {
        let computed = hex::encode(sha2::Digest::finalize(h));
        if !computed.eq_ignore_ascii_case(expected) {
            return Err(AppError::Install(format!(
                "SHA256 mismatch: expected {}, got {}",
                expected, computed
            )));
        }
    }
    Ok(())
}

async fn perform_install(asset: &Asset, package: &Path, target: &Path) -> AppResult<PathBuf> {
    fs::create_dir_all(target)?;
    match asset.asset_type.as_str() {
        "zip" => extract_zip(package, target)?,
        "tar.gz" => extract_tar_gz(package, target)?,
        "msi" | "exe" | "pkg" | "dmg" => {
            return Err(AppError::Install(format!(
                "Installer type '{}' is not yet implemented in the Tauri build. \
                 Use an archive (zip/tar.gz) for now or run the legacy Electron build.",
                asset.asset_type
            )));
        }
        other => {
            return Err(AppError::Install(format!(
                "Unsupported asset type: {}",
                other
            )));
        }
    }
    Ok(target.to_path_buf())
}

fn extract_zip(src: &Path, dest: &Path) -> AppResult<()> {
    let file = fs::File::open(src)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Install(format!("zip open failed: {}", e)))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Install(format!("zip entry: {}", e)))?;
        let outpath = match entry.enclosed_name() {
            Some(p) => dest.join(p),
            None => continue,
        };
        if entry.is_dir() {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = fs::File::create(&outpath)?;
            std::io::copy(&mut entry, &mut out)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = entry.unix_mode() {
                    let _ = fs::set_permissions(&outpath, fs::Permissions::from_mode(mode));
                }
            }
        }
    }
    Ok(())
}

fn extract_tar_gz(src: &Path, dest: &Path) -> AppResult<()> {
    let file = fs::File::open(src)?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    archive
        .unpack(dest)
        .map_err(|e| AppError::Install(format!("tar.gz unpack failed: {}", e)))?;
    Ok(())
}

async fn validate_install(
    tool: &ToolDefinition,
    expected_version: &str,
    installed_path: &Path,
) -> AppResult<()> {
    let command = tool
        .validate
        .command
        .replace("{version}", expected_version)
        .replace("{installedPath}", &installed_path.to_string_lossy())
        .replace("{targetDir}", &installed_path.to_string_lossy());
    if command.trim().is_empty() {
        return Err(AppError::Install("Validation command is empty".into()));
    }
    let output = run_shell(&command).await.map_err(|e| {
        AppError::Install(format!("Validation command failed: {}", e))
    })?;
    let combined = format!("{}\n{}", output.0, output.1).trim().to_string();
    let parse_mode = tool.validate.parse.as_str();
    match parse_mode {
        "exact" => {
            if !combined.contains(expected_version) {
                return Err(AppError::Install(format!(
                    "Validation failed: output \"{}\" does not match expected {}",
                    combined, expected_version
                )));
            }
        }
        "regex" => {
            let pattern = tool
                .validate
                .pattern
                .as_deref()
                .ok_or_else(|| AppError::Install("regex parse mode requires pattern".into()))?;
            let re = regex::Regex::new(pattern)
                .map_err(|e| AppError::Install(format!("invalid regex: {}", e)))?;
            let captured = re.captures(&combined).and_then(|c| c.get(1).or_else(|| c.get(0)));
            let Some(m) = captured else {
                return Err(AppError::Install(
                    "Validation failed: output does not match validate.pattern".into(),
                ));
            };
            if !version_match(m.as_str(), expected_version) {
                return Err(AppError::Install(format!(
                    "Validation failed: detected {} does not match expected {}",
                    m.as_str(),
                    expected_version
                )));
            }
        }
        _ => {
            // semver
            let candidate = extract_semver(&combined).ok_or_else(|| {
                AppError::Install("Validation failed: no semver version found".into())
            })?;
            if !version_match(&candidate, expected_version) {
                return Err(AppError::Install(format!(
                    "Validation failed: detected {} does not match expected {}",
                    candidate, expected_version
                )));
            }
        }
    }
    Ok(())
}

fn extract_semver(text: &str) -> Option<String> {
    let re = regex::Regex::new(r"v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)").unwrap();
    re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

fn version_match(detected: &str, expected: &str) -> bool {
    let normalize = |s: &str| s.trim().trim_start_matches('v').to_string();
    let d = normalize(detected);
    let e = normalize(expected);
    if let (Ok(da), Ok(eb)) = (semver::Version::parse(&d), semver::Version::parse(&e)) {
        return da == eb;
    }
    d == e
}

async fn run_shell(command: &str) -> AppResult<(String, String)> {
    use tokio::process::Command;
    let (program, args) = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C".to_string(), command.to_string()])
    } else {
        ("sh", vec!["-c".to_string(), command.to_string()])
    };
    let output = Command::new(program).args(&args).output().await?;
    Ok((
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}
