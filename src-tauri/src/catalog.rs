use crate::error::{AppError, AppResult};
use crate::paths;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub schema_version: String,
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tags: Option<Vec<String>>,
    pub version_source: VersionSource,
    pub assets: Vec<Asset>,
    pub install: InstallConfig,
    pub validate: ValidateConfig,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dependencies: Option<Vec<Dependency>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auth: Option<ToolAuth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum VersionSource {
    #[serde(rename = "githubReleases")]
    GithubReleases {
        repo: String,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        tag_prefix: Option<String>,
    },
    #[serde(rename = "staticList")]
    StaticList { versions: Vec<String> },
    #[serde(rename = "customJsonFeed")]
    CustomJsonFeed { url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub platform: String, // win | mac | linux
    pub arch: String,     // x64 | arm64 | ia32
    pub url: String,
    #[serde(rename = "type")]
    pub asset_type: String, // msi | exe | pkg | zip | tar.gz | dmg
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallConfig {
    #[serde(rename = "type")]
    pub install_type: String, // msi | exe | pkg | archive
    #[serde(default)]
    pub requires_admin: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub silent_args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub target_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub post_install: Option<Vec<PostInstallAction>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostInstallAction {
    #[serde(rename = "type")]
    pub action_type: String, // addToPath | createShim | runCommand
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateConfig {
    pub command: String,
    #[serde(default = "default_parse")]
    pub parse: String, // semver | regex | exact
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pattern: Option<String>,
}

fn default_parse() -> String {
    "semver".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub id: String,
    #[serde(rename = "type")]
    pub dep_type: String, // hard | soft | platformOnly
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub platforms: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAuth {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub github_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedCatalog {
    pub tools: Vec<ToolDefinition>,
    pub loaded_at: String,
    pub catalog_dir: String,
}

pub fn load_catalog(resource_dir: Option<PathBuf>) -> AppResult<LoadedCatalog> {
    let candidates = paths::bundled_catalog_candidates(resource_dir);
    let mut last_err: Option<AppError> = None;
    for candidate in &candidates {
        if !candidate.exists() {
            continue;
        }
        match load_from_dir(candidate) {
            Ok(mut catalog) => {
                let user_dir = paths::user_catalog_dir();
                if user_dir.exists() && user_dir != *candidate {
                    if let Ok(user) = load_from_dir(&user_dir) {
                        merge_user_tools(&mut catalog, user);
                    }
                }
                return Ok(catalog);
            }
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        AppError::Catalog(format!(
            "No catalog directory found. Tried: {:?}",
            candidates
        ))
    }))
}

fn merge_user_tools(catalog: &mut LoadedCatalog, user: LoadedCatalog) {
    let mut by_id: HashMap<String, ToolDefinition> = catalog
        .tools
        .iter()
        .cloned()
        .map(|t| (t.id.clone(), t))
        .collect();
    for tool in user.tools {
        by_id.insert(tool.id.clone(), tool);
    }
    catalog.tools = by_id.into_values().collect();
    catalog.tools.sort_by(|a, b| a.id.cmp(&b.id));
}

fn load_from_dir(dir: &Path) -> AppResult<LoadedCatalog> {
    let mut tools: Vec<ToolDefinition> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "yaml" && ext != "yml" {
            continue;
        }
        let raw = fs::read_to_string(&path)?;
        let tool: ToolDefinition = serde_yaml::from_str(&raw)
            .map_err(|e| AppError::Catalog(format!("Failed to parse {}: {}", path.display(), e)))?;
        tools.push(tool);
    }
    tools.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(LoadedCatalog {
        tools,
        loaded_at: chrono::Utc::now().to_rfc3339(),
        catalog_dir: dir.to_string_lossy().to_string(),
    })
}

pub fn add_tool_definition(content: &str, overwrite: bool) -> AppResult<ToolDefinition> {
    if content.trim().is_empty() {
        return Err(AppError::Validation(
            "Tool definition content cannot be empty".into(),
        ));
    }
    let tool: ToolDefinition = serde_yaml::from_str(content)?;
    let user_dir = paths::user_catalog_dir();
    fs::create_dir_all(&user_dir)?;
    let target = user_dir.join(format!("{}.yaml", tool.id));
    if target.exists() && !overwrite {
        return Err(AppError::Validation(format!(
            "Tool \"{}\" already exists. Enable overwrite to replace it.",
            tool.id
        )));
    }
    let normalized = if content.ends_with('\n') {
        content.to_string()
    } else {
        format!("{}\n", content)
    };
    fs::write(&target, normalized)?;
    Ok(tool)
}

pub fn remove_tool_definition(tool_id: &str) -> AppResult<()> {
    let id = tool_id.trim();
    if id.is_empty() {
        return Err(AppError::Validation("Tool ID cannot be empty".into()));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(AppError::Validation(
            "Tool ID contains invalid characters".into(),
        ));
    }
    let user_dir = paths::user_catalog_dir();
    let candidates = [
        user_dir.join(format!("{}.yaml", id)),
        user_dir.join(format!("{}.yml", id)),
    ];
    let mut removed = false;
    for path in candidates {
        if path.exists() {
            fs::remove_file(&path)?;
            removed = true;
            break;
        }
    }
    if !removed {
        return Err(AppError::NotFound(format!(
            "Tool \"{}\" definition was not found in user catalog.",
            id
        )));
    }
    Ok(())
}
