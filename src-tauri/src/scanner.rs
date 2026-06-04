//! Scanner — detects which catalog tools are already installed.
//!
//! For now this is a lightweight wrapper around `validate.command` execution,
//! plus the persisted install state (so things we just installed show up
//! immediately). Native registry / pkgutil scanning is a TODO; the
//! validate-command approach handles most CLI tools well.

use crate::catalog::ToolDefinition;
use crate::error::AppResult;
use crate::installer::Installer;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedTool {
    pub id: String,
    pub name: String,
    pub status: String, // installed | missing | error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>, // managed | system | unknown
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub detected_tools: Vec<DetectedTool>,
    pub summary: ScanSummary,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub total: u32,
    pub healthy: u32,
    pub warnings: u32,
    pub errors: u32,
}

pub struct Scanner {
    last_report: Mutex<Option<ScanReport>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl Default for Scanner {
    fn default() -> Self {
        Self {
            last_report: Mutex::new(None),
            app_handle: Mutex::new(None),
        }
    }
}

impl Scanner {
    pub fn set_app_handle(self: &Arc<Self>, handle: tauri::AppHandle) {
        *self.app_handle.lock().unwrap() = Some(handle);
    }

    pub async fn scan_all(&self, tools: &[ToolDefinition], _installer: &Installer) -> ScanReport {
        let mut detected = Vec::with_capacity(tools.len());
        for tool in tools {
            detected.push(scan_one(tool).await);
        }
        let summary = summarize(&detected);
        let report = ScanReport {
            detected_tools: detected,
            summary,
            generated_at: chrono::Utc::now().to_rfc3339(),
        };
        *self.last_report.lock().unwrap() = Some(report.clone());
        if let Some(handle) = self.app_handle.lock().unwrap().as_ref() {
            let _ = handle.emit("event:scanComplete", &report);
        }
        report
    }

    pub async fn scan_one(&self, tool: &ToolDefinition) -> DetectedTool {
        scan_one(tool).await
    }

    pub fn last_report(&self) -> Option<ScanReport> {
        self.last_report.lock().unwrap().clone()
    }
}

fn summarize(items: &[DetectedTool]) -> ScanSummary {
    let mut s = ScanSummary {
        total: items.len() as u32,
        ..Default::default()
    };
    for item in items {
        match item.status.as_str() {
            "installed" => s.healthy += 1,
            "missing" => {}
            _ => s.errors += 1,
        }
    }
    s
}

async fn scan_one(tool: &ToolDefinition) -> DetectedTool {
    let cmd = tool.validate.command.replace("{version}", "");
    if cmd.trim().is_empty() {
        return DetectedTool {
            id: tool.id.clone(),
            name: tool.name.clone(),
            status: "missing".into(),
            version: None,
            source: None,
            message: Some("No validate.command".into()),
        };
    }
    match run_shell(&cmd).await {
        Ok((stdout, stderr)) => {
            let combined = format!("{}\n{}", stdout, stderr);
            if let Some(version) = extract_semver(&combined) {
                DetectedTool {
                    id: tool.id.clone(),
                    name: tool.name.clone(),
                    status: "installed".into(),
                    version: Some(version),
                    source: Some("system".into()),
                    message: None,
                }
            } else {
                DetectedTool {
                    id: tool.id.clone(),
                    name: tool.name.clone(),
                    status: "missing".into(),
                    version: None,
                    source: None,
                    message: Some("validate command did not produce a version".into()),
                }
            }
        }
        Err(_) => DetectedTool {
            id: tool.id.clone(),
            name: tool.name.clone(),
            status: "missing".into(),
            version: None,
            source: None,
            message: Some("validate command failed".into()),
        },
    }
}

fn extract_semver(text: &str) -> Option<String> {
    let re = regex::Regex::new(r"v?(\d+\.\d+\.\d+)").ok()?;
    re.captures(text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
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
