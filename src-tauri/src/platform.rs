use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::paths;

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

#[cfg(target_os = "windows")]
use windows::{
    core::PCWSTR,
    Win32::UI::{
        Shell::{IsUserAnAdmin, ShellExecuteW},
        WindowsAndMessaging::SW_SHOWNORMAL,
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub version: String,
    pub is_admin: bool,
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
        version: detect_version(),
        is_admin: is_admin(),
        paths: PlatformPaths {
            managed: managed.to_string_lossy().to_string(),
            app_data: app_data.to_string_lossy().to_string(),
            home: home.to_string_lossy().to_string(),
            temp: temp.to_string_lossy().to_string(),
        },
    }
}

pub fn is_admin() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        return IsUserAnAdmin().as_bool();
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub fn relaunch_as_admin() -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(AppError::Io)?;
        let exe_wide = to_wide(exe.as_os_str());
        let verb_wide = to_wide("runas");

        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(verb_wide.as_ptr()),
                PCWSTR(exe_wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };

        if result.0 as isize <= 32 {
            return Err(AppError::Other(format!(
                "failed to request administrator restart: ShellExecuteW returned {}",
                result.0 as isize
            )));
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(AppError::Validation(
            "Administrator restart is only supported on Windows.".to_string(),
        ))
    }
}

fn detect_version() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("OS").unwrap_or_else(|_| "Windows".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        "macOS".to_string()
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        "Linux".to_string()
    }
}

#[cfg(target_os = "windows")]
fn to_wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

pub async fn detect_and_log() -> anyhow::Result<()> {
    let info = detect();
    tracing::info!(os = %info.os, arch = %info.arch, is_admin = info.is_admin, "platform detected");
    Ok(())
}
