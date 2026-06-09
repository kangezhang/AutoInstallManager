use std::path::PathBuf;

const APP_FOLDER: &str = "DevStack Manager";

/// User-writable app data: `%APPDATA%/DevStack Manager` (Win) /
/// `~/Library/Application Support/DevStack Manager` (mac) /
/// `~/.config/DevStack Manager` (linux).
pub fn app_data_dir() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::data_dir)
        .map(|d| d.join(APP_FOLDER))
        .unwrap_or_else(|| std::env::temp_dir().join(APP_FOLDER))
}

/// Where managed installs live by default. We keep them under the user
/// profile to avoid needing admin: `%LOCALAPPDATA%/Programs/DevStack Manager`
/// on Windows, `~/.local/share/DevStack Manager/managed` elsewhere.
pub fn managed_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        dirs::data_local_dir()
            .map(|d| d.join("Programs").join(APP_FOLDER))
            .unwrap_or_else(|| std::env::temp_dir().join(APP_FOLDER))
    } else {
        dirs::data_local_dir()
            .or_else(dirs::home_dir)
            .map(|d| d.join(APP_FOLDER).join("managed"))
            .unwrap_or_else(|| std::env::temp_dir().join(APP_FOLDER))
    }
}

pub fn user_catalog_dir() -> PathBuf {
    app_data_dir().join("catalog")
}

pub fn shims_dir() -> PathBuf {
    app_data_dir().join("shims")
}

pub fn install_state_path() -> PathBuf {
    app_data_dir().join("state").join("installed-tools.json")
}

pub fn accounts_store_path() -> PathBuf {
    app_data_dir().join("github-accounts.json")
}

pub fn keyfile_path() -> PathBuf {
    app_data_dir().join("keystore.bin")
}

/// Try a few candidate directories to find the bundled `catalog/` folder.
/// During development this is the workspace's `catalog/` next to `src-tauri/`.
/// In a packaged app it sits in resources via tauri.conf bundle.resources.
pub fn bundled_catalog_candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    if let Ok(env_dir) = std::env::var("DEVSTACK_CATALOG_DIR") {
        let trimmed = env_dir.trim();
        if !trimmed.is_empty() {
            out.push(PathBuf::from(trimmed));
            return out;
        }
    }

    if let Some(res) = resource_dir {
        out.push(res.join("catalog"));
        out.push(res.join("_up_").join("catalog"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join("catalog"));
        if let Some(parent) = cwd.parent() {
            out.push(parent.join("catalog"));
        }
    }

    out
}
