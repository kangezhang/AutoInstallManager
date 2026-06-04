use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub paths: PlatformPaths,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPaths {
    pub managed: String,
    pub app_data: String,
    pub home: String,
    pub temp: String,
}

pub fn detect() -> PlatformInfo {
    let os = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };

    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "ia32"
    };

    let app_data = paths::app_data_dir();
    let home: PathBuf = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let temp = std::env::temp_dir();
    let managed = paths::managed_dir();

    PlatformInfo {
        os: os.to_string(),
        arch: arch.to_string(),
        paths: PlatformPaths {
            managed: managed.to_string_lossy().to_string(),
            app_data: app_data.to_string_lossy().to_string(),
            home: home.to_string_lossy().to_string(),
            temp: temp.to_string_lossy().to_string(),
        },
    }
}

pub async fn detect_and_log() -> anyhow::Result<()> {
    let info = detect();
    tracing::info!(os = %info.os, arch = %info.arch, "platform detected");
    Ok(())
}
