//! DevStack Manager - Tauri Edition
//!
//! Rust backend organized into focused modules:
//! - `error`: unified error type for Tauri commands
//! - `platform`: OS / arch detection + managed paths
//! - `accounts`: encrypted GitHub account storage
//! - `catalog`: YAML tool definitions loading + add/remove
//! - `github`: REST API wrappers (repos, forks, PRs, releases)
//! - `installer`: download / extract / validate / rollback / uninstall
//! - `scanner`: detect already-installed tools
//! - `dialogs`: native folder/file pickers

pub mod accounts;
pub mod catalog;
pub mod commands;
pub mod dualnet;
pub mod error;
pub mod git_local;
pub mod github;
pub mod installer;
pub mod paths;
pub mod platform;
pub mod scanner;

use commands::*;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    pub catalog: Arc<RwLock<Option<catalog::LoadedCatalog>>>,
    pub installer: Arc<installer::Installer>,
    pub scanner: Arc<scanner::Scanner>,
    pub git_registry: Arc<git_local::Registry>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // platform
            platform_get_info,
            platform_relaunch_as_admin,
            // catalog
            catalog_load,
            catalog_list_tools,
            catalog_get_tool,
            catalog_get_versions,
            catalog_add_tool_definition,
            catalog_remove_tool_definition,
            // github accounts
            github_account_list,
            github_account_upsert,
            github_account_remove,
            github_account_set_default,
            github_account_get_default_credential,
            github_account_login_with_browser,
            // github repo
            github_repo_create,
            github_repo_list_mine,
            github_repo_get_info,
            github_repo_list_commits,
            github_repo_fork,
            github_repo_clone,
            github_repo_create_from_folder,
            github_repo_upsert_file,
            github_repo_pick_clone_dest,
            github_repo_pick_local_folder,
            github_repo_list_forks,
            // pull requests
            github_pr_create,
            github_pr_list,
            // release
            release_pick_asset_file,
            release_upload_asset,
            release_discover_from_link,
            // installer
            install_create,
            install_start,
            install_cancel,
            install_rollback,
            install_uninstall,
            install_status,
            install_list,
            // scanner
            scan_start,
            scan_tool,
            scan_get_report,
            // dualnet
            dualnet_scan_adapters,
            dualnet_client_apply_ip_preset,
            dualnet_client_restore_dhcp,
            // git local
            git_local_list,
            git_local_pick_and_add,
            git_local_add_path,
            git_local_remove,
            git_local_set_favorite,
            git_local_rename,
            git_local_summary,
            git_local_status,
            git_local_log,
            git_local_branches,
            git_local_remotes,
            git_local_tags,
            git_local_diff,
            git_local_stage,
            git_local_stage_all,
            git_local_untrack_ignored,
            git_local_unstage,
            git_local_discard,
            git_local_commit,
            git_local_push,
            git_local_pull,
        ])
        .setup(|app| {
            let state: tauri::State<AppState> = app.state();
            let scanner = state.scanner.clone();
            let installer = state.installer.clone();
            let app_handle = app.handle().clone();

            installer.set_app_handle(app_handle.clone());
            scanner.set_app_handle(app_handle);

            tauri::async_runtime::spawn(async move {
                if let Err(err) = platform::detect_and_log().await {
                    tracing::warn!("platform detection failed: {err:?}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
