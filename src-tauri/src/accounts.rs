use crate::error::{AppError, AppResult};
use crate::paths;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAccount {
    pub id: String,
    pub display_name: String,
    pub username: String,
    pub host: String,
    pub token_encrypted: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct AccountStore {
    pub default_account_id: Option<String>,
    pub accounts: Vec<StoredAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub display_name: String,
    pub username: String,
    pub host: String,
    pub has_token: bool,
    pub is_default: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountListResult {
    pub default_account_id: Option<String>,
    pub accounts: Vec<AccountSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUpsertRequest {
    pub id: Option<String>,
    pub display_name: String,
    pub username: String,
    pub host: Option<String>,
    pub token: Option<String>,
    #[serde(default)]
    pub set_as_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCredential {
    pub account_id: String,
    pub display_name: String,
    pub username: String,
    pub host: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountBrowserLoginResult {
    pub account: AccountSummary,
    pub created: bool,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn normalize_host(host: Option<&str>) -> String {
    let raw = host.unwrap_or("github.com").trim().to_lowercase();
    if raw.is_empty() {
        "github.com".to_string()
    } else {
        raw
    }
}

fn require_field(value: &str, field: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AppError::Validation(format!("{} cannot be empty", field)))
    } else {
        Ok(trimmed.to_string())
    }
}

/// Load (or generate-and-persist) a 32-byte master key for AES-GCM. We keep
/// this in `app_data/keystore.bin` with restrictive permissions on Unix.
fn load_or_create_master_key() -> AppResult<[u8; 32]> {
    let path = paths::keyfile_path();
    if path.exists() {
        let bytes = fs::read(&path)?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
        // corrupted; regenerate
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(&path, key)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        let _ = fs::set_permissions(&path, perms);
    }
    Ok(key)
}

fn encrypt_token(token: &str) -> AppResult<String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Token cannot be empty".into()));
    }
    let key_bytes = load_or_create_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| AppError::Other(format!("cipher init failed: {e}")))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, trimmed.as_bytes())
        .map_err(|e| AppError::Other(format!("encrypt failed: {e}")))?;
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(format!("v2:enc:{}", B64.encode(combined)))
}

fn decrypt_token(payload: &str) -> AppResult<String> {
    if payload.is_empty() {
        return Ok(String::new());
    }
    if let Some(rest) = payload.strip_prefix("v2:enc:") {
        let combined = B64
            .decode(rest)
            .map_err(|e| AppError::Other(format!("base64: {e}")))?;
        if combined.len() < 13 {
            return Err(AppError::Auth("encrypted payload too short".into()));
        }
        let key_bytes = load_or_create_master_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| AppError::Other(format!("cipher init failed: {e}")))?;
        let (nonce_bytes, cipher_bytes) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);
        let plain = cipher
            .decrypt(nonce, cipher_bytes)
            .map_err(|e| AppError::Auth(format!("decrypt failed: {e}")))?;
        return String::from_utf8(plain)
            .map_err(|e| AppError::Other(format!("utf8: {e}")));
    }
    if let Some(rest) = payload.strip_prefix("v1:plain:") {
        let bytes = B64
            .decode(rest)
            .map_err(|e| AppError::Other(format!("base64: {e}")))?;
        return String::from_utf8(bytes).map_err(|e| AppError::Other(format!("utf8: {e}")));
    }
    // Unknown / legacy: return empty so we don't accidentally surface garbage.
    Ok(String::new())
}

fn load_store() -> AppResult<AccountStore> {
    let path = paths::accounts_store_path();
    if !path.exists() {
        return Ok(AccountStore::default());
    }
    let raw = fs::read_to_string(&path)?;
    let parsed: AccountStore = serde_json::from_str(&raw).unwrap_or_default();
    Ok(normalize_store(parsed))
}

fn save_store(store: &AccountStore) -> AppResult<()> {
    let path = paths::accounts_store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(store)?;
    fs::write(&path, json)?;
    Ok(())
}

fn normalize_store(mut store: AccountStore) -> AccountStore {
    let ids: std::collections::HashSet<String> =
        store.accounts.iter().map(|a| a.id.clone()).collect();
    if let Some(default_id) = &store.default_account_id {
        if !ids.contains(default_id) {
            store.default_account_id = store.accounts.first().map(|a| a.id.clone());
        }
    } else if !store.accounts.is_empty() {
        store.default_account_id = store.accounts.first().map(|a| a.id.clone());
    }
    store
}

fn to_summary(account: &StoredAccount, default_id: Option<&str>) -> AccountSummary {
    let has_token = decrypt_token(&account.token_encrypted)
        .map(|t| !t.is_empty())
        .unwrap_or(false);
    AccountSummary {
        id: account.id.clone(),
        display_name: account.display_name.clone(),
        username: account.username.clone(),
        host: account.host.clone(),
        has_token,
        is_default: default_id == Some(account.id.as_str()),
        updated_at: account.updated_at.clone(),
    }
}

pub fn list() -> AppResult<AccountListResult> {
    let store = load_store()?;
    let mut accounts = store.accounts.clone();
    accounts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let default_id = store.default_account_id.clone();
    let summaries = accounts
        .iter()
        .map(|a| to_summary(a, default_id.as_deref()))
        .collect();
    Ok(AccountListResult {
        default_account_id: default_id,
        accounts: summaries,
    })
}

pub fn upsert(payload: AccountUpsertRequest) -> AppResult<AccountSummary> {
    let mut store = load_store()?;
    let display_name = require_field(&payload.display_name, "Display name")?;
    let username = require_field(&payload.username, "Username")?;
    let host = normalize_host(payload.host.as_deref());
    let now = now_iso();

    let existing_index = if let Some(id) = payload.id.as_deref() {
        store.accounts.iter().position(|a| a.id == id)
    } else {
        store.accounts.iter().position(|a| {
            a.username.eq_ignore_ascii_case(&username) && a.host == host
        })
    };

    if let Some(idx) = existing_index {
        let existing_token = store.accounts[idx].token_encrypted.clone();
        let next_token = match payload.token.as_ref() {
            Some(t) if !t.trim().is_empty() => encrypt_token(t)?,
            _ => existing_token,
        };
        store.accounts[idx].display_name = display_name;
        store.accounts[idx].username = username;
        store.accounts[idx].host = host;
        store.accounts[idx].token_encrypted = next_token;
        store.accounts[idx].updated_at = now;
        if payload.set_as_default {
            store.default_account_id = Some(store.accounts[idx].id.clone());
        }
        let normalized = normalize_store(store);
        save_store(&normalized)?;
        let acc = &normalized.accounts[idx];
        return Ok(to_summary(acc, normalized.default_account_id.as_deref()));
    }

    let token = require_field(payload.token.as_deref().unwrap_or(""), "Token")?;
    let id = payload.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let created = StoredAccount {
        id: id.clone(),
        display_name,
        username,
        host,
        token_encrypted: encrypt_token(&token)?,
        created_at: now.clone(),
        updated_at: now,
    };
    store.accounts.push(created);
    if store.default_account_id.is_none() || payload.set_as_default {
        store.default_account_id = Some(id.clone());
    }
    let normalized = normalize_store(store);
    save_store(&normalized)?;
    let acc = normalized
        .accounts
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| AppError::Other("account vanished after save".into()))?;
    Ok(to_summary(acc, normalized.default_account_id.as_deref()))
}

pub fn remove(account_id: &str) -> AppResult<()> {
    let target = require_field(account_id, "Account ID")?;
    let mut store = load_store()?;
    let before = store.accounts.len();
    store.accounts.retain(|a| a.id != target);
    if store.accounts.len() == before {
        return Err(AppError::NotFound(format!(
            "GitHub account not found: {}",
            target
        )));
    }
    if store.default_account_id.as_deref() == Some(target.as_str()) {
        store.default_account_id = None;
    }
    let normalized = normalize_store(store);
    save_store(&normalized)?;
    Ok(())
}

pub fn set_default(account_id: &str) -> AppResult<()> {
    let target = require_field(account_id, "Account ID")?;
    let mut store = load_store()?;
    if !store.accounts.iter().any(|a| a.id == target) {
        return Err(AppError::NotFound(format!(
            "GitHub account not found: {}",
            target
        )));
    }
    store.default_account_id = Some(target);
    save_store(&store)?;
    Ok(())
}

pub fn get_credential(account_id: Option<&str>) -> AppResult<Option<AccountCredential>> {
    let store = load_store()?;
    let target = account_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| store.default_account_id.clone());
    let Some(target) = target else { return Ok(None) };
    let Some(account) = store.accounts.iter().find(|a| a.id == target) else {
        return Ok(None);
    };
    let token = decrypt_token(&account.token_encrypted)?;
    if token.is_empty() {
        return Ok(None);
    }
    Ok(Some(AccountCredential {
        account_id: account.id.clone(),
        display_name: account.display_name.clone(),
        username: account.username.clone(),
        host: account.host.clone(),
        token,
    }))
}

/// Browser/git-based login: ask `git credential fill` for the host's stored
/// credential. This works when the user has previously authenticated via the
/// official `gh auth` flow or git-credential-manager.
pub async fn login_with_browser(host: Option<String>) -> AppResult<AccountBrowserLoginResult> {
    let host = normalize_host(host.as_deref());
    let credential = run_git_credential_fill(&host).await?;
    let username = require_field(
        credential.get("username").map(String::as_str).unwrap_or(""),
        "Username",
    )?;
    let token = require_field(
        credential.get("password").map(String::as_str).unwrap_or(""),
        "Token",
    )?;
    let display_name = format!("{}@{}", username, host);
    let before = list()?;
    let account = upsert(AccountUpsertRequest {
        id: None,
        display_name: display_name.clone(),
        username: username.clone(),
        host: Some(host.clone()),
        token: Some(token),
        set_as_default: before.accounts.is_empty(),
    })?;
    let created = !before
        .accounts
        .iter()
        .any(|item| item.username == account.username && item.host == account.host);
    Ok(AccountBrowserLoginResult { account, created })
}

async fn run_git_credential_fill(
    host: &str,
) -> AppResult<std::collections::HashMap<String, String>> {
    use tokio::io::AsyncWriteExt;
    use tokio::process::Command;

    let mut cmd = Command::new("git");
    cmd.args(["credential", "fill"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Other("Git is not installed or not in PATH.".into())
        } else {
            AppError::Io(e)
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let query = format!("protocol=https\nhost={}\n\n", host);
        stdin.write_all(query.as_bytes()).await?;
        stdin.shutdown().await.ok();
    }

    let output = child.wait_with_output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Auth(if stderr.is_empty() {
            format!("git credential fill failed (status {})", output.status)
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map = std::collections::HashMap::new();
    for line in stdout.lines() {
        if let Some(eq_idx) = line.find('=') {
            let key = line[..eq_idx].trim().to_string();
            let value = line[eq_idx + 1..].trim().to_string();
            if !key.is_empty() {
                map.insert(key, value);
            }
        }
    }
    Ok(map)
}

#[allow(dead_code)]
pub fn store_path() -> &'static Path {
    // for tests/dev — not used in commands
    Box::leak(paths::accounts_store_path().into_boxed_path())
}
