//! Thin HTTP wrappers over the GitHub REST API. We intentionally keep this
//! procedural — most calls are one-off and the existing TypeScript already
//! proved the contract.

use crate::accounts;
use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, Method, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

pub const API_BASE: &str = "https://api.github.com";

static HTTP: OnceLock<Client> = OnceLock::new();

pub fn http() -> &'static Client {
    HTTP.get_or_init(|| {
        Client::builder()
            .user_agent("AutoInstallManager")
            .timeout(Duration::from_secs(120))
            .build()
            .expect("build reqwest client")
    })
}

fn json_headers(token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("accept"),
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static("AutoInstallManager"));
    headers.insert(
        HeaderName::from_static("x-github-api-version"),
        HeaderValue::from_static("2022-11-28"),
    );
    if let Some(token) = token {
        let value = format!("Bearer {}", token.trim());
        if let Ok(hv) = HeaderValue::from_str(&value) {
            headers.insert(AUTHORIZATION, hv);
        }
    }
    headers
}

async fn read_error(resp: Response) -> String {
    let status = resp.status();
    match resp.text().await {
        Ok(text) => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(msg) = parsed.get("message").and_then(|v| v.as_str()) {
                    return msg.to_string();
                }
            }
            if !text.trim().is_empty() {
                return text.trim().to_string();
            }
            format!("{} {}", status.as_u16(), status.canonical_reason().unwrap_or(""))
        }
        Err(_) => format!("{}", status),
    }
}

/// Resolve a token. Token literally provided wins. Then account_id, then
/// the default account credential. Errors if `required` and nothing found.
pub fn resolve_token(
    token: Option<&str>,
    account_id: Option<&str>,
    required: bool,
) -> AppResult<Option<String>> {
    if let Some(t) = token {
        let trimmed = t.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }
    let cred = accounts::get_credential(account_id)?;
    if let Some(c) = cred {
        if !c.token.trim().is_empty() {
            return Ok(Some(c.token));
        }
    }
    if required {
        Err(AppError::Auth(
            "GitHub token cannot be empty. Configure a global GitHub account in Settings.".into(),
        ))
    } else {
        Ok(None)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    pub private: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub default_branch: Option<String>,
    pub html_url: String,
    pub ssh_url: String,
    pub https_url: String,
}

#[derive(Debug, Deserialize)]
struct RepoApiItem {
    id: u64,
    name: String,
    full_name: String,
    description: Option<String>,
    private: bool,
    default_branch: Option<String>,
    html_url: String,
    ssh_url: String,
    clone_url: String,
}

fn map_repo(item: RepoApiItem) -> RepoInfo {
    RepoInfo {
        id: item.id,
        name: item.name,
        full_name: item.full_name,
        description: item.description.filter(|s| !s.is_empty()),
        private: item.private,
        default_branch: item.default_branch.filter(|s| !s.is_empty()),
        html_url: item.html_url,
        ssh_url: item.ssh_url,
        https_url: item.clone_url,
    }
}

pub fn parse_repo(input: &str) -> AppResult<(String, String)> {
    let normalized = input.trim().trim_end_matches(".git");
    if normalized.is_empty() {
        return Err(AppError::Validation("Repository is required".into()));
    }
    let url_re = regex::Regex::new(r"^https?://github\.com/([^/]+)/([^/]+)/?$").unwrap();
    if let Some(caps) = url_re.captures(normalized) {
        return Ok((caps[1].to_string(), caps[2].to_string()));
    }
    let short_re = regex::Regex::new(r"^([^/]+)/([^/]+)$").unwrap();
    if let Some(caps) = short_re.captures(normalized) {
        return Ok((caps[1].to_string(), caps[2].to_string()));
    }
    Err(AppError::Validation(
        "Invalid repository format. Use owner/repo or a GitHub repository URL.".into(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCreateRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub add_readme: Option<bool>,
    #[serde(default)]
    pub gitignore_template: Option<String>,
    #[serde(default)]
    pub license_template: Option<String>,
    #[serde(default)]
    pub private: Option<bool>,
    #[serde(default)]
    pub auto_init: Option<bool>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub async fn create_repo(payload: RepoCreateRequest) -> AppResult<RepoInfo> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Repository name cannot be empty".into()));
    }
    let visibility = payload.visibility.as_deref().map(|v| v.trim().to_lowercase());
    let is_private = match visibility.as_deref() {
        Some("private") => true,
        Some("public") => false,
        _ => payload.private.unwrap_or(false),
    };
    let gitignore = payload.gitignore_template.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let license = payload.license_template.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let add_readme = payload.add_readme.unwrap_or(payload.auto_init.unwrap_or(false));
    let auto_init = add_readme || gitignore.is_some() || license.is_some();

    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), true)?
        .ok_or_else(|| AppError::Auth("Token required".into()))?;

    let mut body = serde_json::json!({
        "name": name,
        "private": is_private,
        "auto_init": auto_init,
    });
    if let Some(desc) = payload.description.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["description"] = serde_json::Value::String(desc.to_string());
    }
    if let Some(g) = gitignore {
        body["gitignore_template"] = serde_json::Value::String(g.to_string());
    }
    if let Some(l) = license {
        body["license_template"] = serde_json::Value::String(l.to_string());
    }

    let mut headers = json_headers(Some(&token));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let resp = http()
        .post(format!("{}/user/repos", API_BASE))
        .headers(headers)
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to create repository: {}",
            read_error(resp).await
        )));
    }
    let item: RepoApiItem = resp.json().await?;
    Ok(map_repo(item))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoQueryRequest {
    pub repo: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub async fn get_repo(payload: RepoQueryRequest) -> AppResult<RepoInfo> {
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), false)?;
    let (owner, repo) = parse_repo(&payload.repo)?;
    let resp = http()
        .get(format!("{}/repos/{}/{}", API_BASE, owner, repo))
        .headers(json_headers(token.as_deref()))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to fetch repository: {}",
            read_error(resp).await
        )));
    }
    let item: RepoApiItem = resp.json().await?;
    Ok(map_repo(item))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListMineRequest {
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub per_page: Option<u32>,
    #[serde(default)]
    pub max_pages: Option<u32>,
}

pub async fn list_mine(payload: ListMineRequest) -> AppResult<Vec<RepoInfo>> {
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), true)?
        .ok_or_else(|| AppError::Auth("Token required".into()))?;
    let per_page = payload.per_page.unwrap_or(100).clamp(1, 100);
    let max_pages = payload.max_pages.unwrap_or(5).clamp(1, 20);

    let mut out: Vec<RepoInfo> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for page in 1..=max_pages {
        let resp = http()
            .get(format!(
                "{}/user/repos?per_page={}&page={}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member",
                API_BASE, per_page, page
            ))
            .headers(json_headers(Some(&token)))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to list repositories: {}",
                read_error(resp).await
            )));
        }
        let items: Vec<RepoApiItem> = resp.json().await?;
        let count = items.len();
        for item in items {
            let repo = map_repo(item);
            if seen.insert(repo.full_name.clone()) {
                out.push(repo);
            }
        }
        if (count as u32) < per_page {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    pub html_url: String,
}

#[derive(Debug, Deserialize)]
struct CommitApiItem {
    sha: String,
    html_url: String,
    commit: Option<CommitDetail>,
}

#[derive(Debug, Deserialize)]
struct CommitDetail {
    message: Option<String>,
    author: Option<CommitAuthor>,
}

#[derive(Debug, Deserialize)]
struct CommitAuthor {
    name: Option<String>,
    email: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitsRequest {
    pub repo: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub per_page: Option<u32>,
    #[serde(default)]
    pub branch: Option<String>,
}

pub async fn list_commits(payload: CommitsRequest) -> AppResult<Vec<CommitInfo>> {
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), false)?;
    let (owner, repo) = parse_repo(&payload.repo)?;
    let per_page = payload.per_page.unwrap_or(20).clamp(1, 100);
    let mut url = format!(
        "{}/repos/{}/{}/commits?per_page={}",
        API_BASE, owner, repo, per_page
    );
    if let Some(b) = payload.branch.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        url.push_str(&format!("&sha={}", urlencoding::encode(b)));
    }
    let resp = http().get(&url).headers(json_headers(token.as_deref())).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to fetch commits: {}",
            read_error(resp).await
        )));
    }
    let items: Vec<CommitApiItem> = resp.json().await?;
    Ok(items
        .into_iter()
        .map(|item| {
            let detail = item.commit;
            let (msg, author) = match detail {
                Some(d) => (d.message, d.author),
                None => (None, None),
            };
            CommitInfo {
                sha: item.sha,
                message: msg
                    .map(|m| m.trim().to_string())
                    .filter(|m| !m.is_empty())
                    .unwrap_or_else(|| "(no message)".to_string()),
                author_name: author.as_ref().and_then(|a| a.name.clone()),
                author_email: author.as_ref().and_then(|a| a.email.clone()),
                date: author.as_ref().and_then(|a| a.date.clone()),
                html_url: item.html_url,
            }
        })
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkRequest {
    pub repo: String,
    #[serde(default)]
    pub organization: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub default_branch_only: Option<bool>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub async fn fork_repo(payload: ForkRequest) -> AppResult<RepoInfo> {
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), true)?
        .ok_or_else(|| AppError::Auth("Token required".into()))?;
    let (owner, repo) = parse_repo(&payload.repo)?;
    let mut body = serde_json::Map::new();
    if let Some(org) = payload.organization.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body.insert("organization".into(), serde_json::Value::String(org.to_string()));
    }
    if let Some(name) = payload.name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body.insert("name".into(), serde_json::Value::String(name.to_string()));
    }
    if let Some(only) = payload.default_branch_only {
        body.insert("default_branch_only".into(), serde_json::Value::Bool(only));
    }
    let mut headers = json_headers(Some(&token));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let resp = http()
        .post(format!("{}/repos/{}/{}/forks", API_BASE, owner, repo))
        .headers(headers)
        .json(&serde_json::Value::Object(body))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to fork repository: {}",
            read_error(resp).await
        )));
    }
    let item: RepoApiItem = resp.json().await?;
    Ok(map_repo(item))
}

pub async fn list_forks(payload: RepoQueryRequest) -> AppResult<Vec<RepoInfo>> {
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), false)?;
    let (owner, repo) = parse_repo(&payload.repo)?;
    let resp = http()
        .get(format!(
            "{}/repos/{}/{}/forks?per_page=100&sort=newest",
            API_BASE, owner, repo
        ))
        .headers(json_headers(token.as_deref()))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to list forks: {}",
            read_error(resp).await
        )));
    }
    let items: Vec<RepoApiItem> = resp.json().await?;
    Ok(items.into_iter().map(map_repo).collect())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRequest {
    pub repo: String,
    pub dest_path: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub depth: Option<u32>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub async fn clone_repo(payload: CloneRequest) -> GitOperationResult {
    let dest = payload.dest_path.trim().to_string();
    if dest.is_empty() {
        return GitOperationResult {
            success: false,
            output: None,
            error: Some("Destination path is required".into()),
        };
    }
    let token = match resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), false) {
        Ok(t) => t,
        Err(e) => {
            return GitOperationResult {
                success: false,
                output: None,
                error: Some(e.to_string()),
            }
        }
    };
    let (owner, repo) = match parse_repo(&payload.repo) {
        Ok(v) => v,
        Err(e) => {
            return GitOperationResult {
                success: false,
                output: None,
                error: Some(e.to_string()),
            }
        }
    };

    let dest_path = PathBuf::from(&dest);
    let dest_clone = dest_path.clone();
    let owner_c = owner.clone();
    let repo_c = repo.clone();
    let branch = payload.branch.clone().filter(|s| !s.trim().is_empty());
    let depth = payload.depth;

    // git2 is sync — wrap on a blocking thread.
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let mut callbacks = git2::RemoteCallbacks::new();
        if let Some(t) = token.as_ref() {
            let token_owned = t.clone();
            callbacks.credentials(move |_url, _user, _allowed| {
                git2::Cred::userpass_plaintext("x-access-token", &token_owned)
            });
        }
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        if let Some(d) = depth {
            fetch_opts.depth(d as i32);
        }
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_opts);
        if let Some(b) = branch.as_deref() {
            builder.branch(b);
        }
        let url = format!("https://github.com/{}/{}.git", owner_c, repo_c);
        builder
            .clone(&url, &dest_clone)
            .map(|_| format!("Cloned {}/{} to {}", owner_c, repo_c, dest_clone.display()))
            .map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(msg)) => GitOperationResult {
            success: true,
            output: Some(msg),
            error: None,
        },
        Ok(Err(e)) => GitOperationResult {
            success: false,
            output: None,
            error: Some(e),
        },
        Err(e) => GitOperationResult {
            success: false,
            output: None,
            error: Some(format!("clone task failed: {}", e)),
        },
    }
}

// ---------------- Pull Requests ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestInfo {
    pub id: u64,
    pub number: u64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_at: Option<String>,
    pub head: PullRequestRef,
    pub base: PullRequestRefBase,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRef {
    pub r#ref: String,
    pub sha: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<PullRequestRefRepo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRefBase {
    pub r#ref: String,
    pub sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRefRepo {
    pub full_name: String,
}

#[derive(Debug, Deserialize)]
struct PullRequestApiItem {
    id: u64,
    number: u64,
    title: String,
    body: Option<String>,
    state: String,
    draft: bool,
    html_url: String,
    created_at: String,
    updated_at: String,
    merged_at: Option<String>,
    head: PrApiBranch,
    base: PrApiBranchBase,
}

#[derive(Debug, Deserialize)]
struct PrApiBranch {
    #[serde(rename = "ref")]
    r_ref: String,
    sha: String,
    repo: Option<PrApiRepo>,
}

#[derive(Debug, Deserialize)]
struct PrApiBranchBase {
    #[serde(rename = "ref")]
    r_ref: String,
    sha: String,
}

#[derive(Debug, Deserialize)]
struct PrApiRepo {
    full_name: String,
}

fn map_pr(item: PullRequestApiItem) -> PullRequestInfo {
    PullRequestInfo {
        id: item.id,
        number: item.number,
        title: item.title,
        body: item.body.filter(|s| !s.is_empty()),
        state: item.state,
        draft: item.draft,
        html_url: item.html_url,
        created_at: item.created_at,
        updated_at: item.updated_at,
        merged_at: item.merged_at.filter(|s| !s.is_empty()),
        head: PullRequestRef {
            r#ref: item.head.r_ref,
            sha: item.head.sha,
            repo: item.head.repo.map(|r| PullRequestRefRepo {
                full_name: r.full_name,
            }),
        },
        base: PullRequestRefBase {
            r#ref: item.base.r_ref,
            sha: item.base.sha,
        },
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCreateRequest {
    pub repo: String,
    pub title: String,
    pub head: String,
    pub base: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: Option<bool>,
    #[serde(default)]
    pub maintainer_can_modify: Option<bool>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub async fn create_pr(payload: PullRequestCreateRequest) -> AppResult<PullRequestInfo> {
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), true)?
        .ok_or_else(|| AppError::Auth("Token required".into()))?;
    let (owner, repo) = parse_repo(&payload.repo)?;
    let title = payload.title.trim();
    let head = payload.head.trim();
    let base = payload.base.trim();
    if title.is_empty() {
        return Err(AppError::Validation("Pull request title is required".into()));
    }
    if head.is_empty() {
        return Err(AppError::Validation("Head branch is required".into()));
    }
    if base.is_empty() {
        return Err(AppError::Validation("Base branch is required".into()));
    }
    let mut body = serde_json::json!({
        "title": title,
        "head": head,
        "base": base,
        "draft": payload.draft.unwrap_or(false),
        "maintainer_can_modify": payload.maintainer_can_modify.unwrap_or(true),
    });
    if let Some(b) = payload.body.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["body"] = serde_json::Value::String(b.to_string());
    }
    let mut headers = json_headers(Some(&token));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let resp = http()
        .post(format!("{}/repos/{}/{}/pulls", API_BASE, owner, repo))
        .headers(headers)
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to create pull request: {}",
            read_error(resp).await
        )));
    }
    let item: PullRequestApiItem = resp.json().await?;
    Ok(map_pr(item))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestListRequest {
    pub repo: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub per_page: Option<u32>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub async fn list_prs(payload: PullRequestListRequest) -> AppResult<Vec<PullRequestInfo>> {
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), false)?;
    let (owner, repo) = parse_repo(&payload.repo)?;
    let per_page = payload.per_page.unwrap_or(30).clamp(1, 100);
    let state = payload.state.unwrap_or_else(|| "open".into());
    let resp = http()
        .get(format!(
            "{}/repos/{}/{}/pulls?state={}&per_page={}",
            API_BASE, owner, repo, state, per_page
        ))
        .headers(json_headers(token.as_deref()))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to list pull requests: {}",
            read_error(resp).await
        )));
    }
    let items: Vec<PullRequestApiItem> = resp.json().await?;
    Ok(items.into_iter().map(map_pr).collect())
}

// ---------------- Releases ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub id: u64,
    pub name: String,
    pub download_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSummary {
    pub id: u64,
    pub tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub draft: bool,
    pub prerelease: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseApiItem {
    id: u64,
    tag_name: String,
    name: Option<String>,
    draft: Option<bool>,
    prerelease: Option<bool>,
    published_at: Option<String>,
    assets: Option<Vec<ReleaseAssetApi>>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAssetApi {
    id: u64,
    name: String,
    browser_download_url: String,
    content_type: Option<String>,
    size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDiscoverResult {
    pub repo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_asset_name: Option<String>,
    pub releases: Vec<ReleaseSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDiscoverRequest {
    pub source: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
}

struct ParsedSource {
    repo: String,
    tag: Option<String>,
    asset_name: Option<String>,
}

fn parse_source_link(input: &str) -> AppResult<ParsedSource> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err(AppError::Validation("Source link cannot be empty".into()));
    }
    let normalized = raw.trim_end_matches(".git");
    let short_re = regex::Regex::new(r"^([^/]+)/([^/]+)$").unwrap();
    if let Some(caps) = short_re.captures(normalized) {
        return Ok(ParsedSource {
            repo: format!("{}/{}", &caps[1], &caps[2]),
            tag: None,
            asset_name: None,
        });
    }
    let url = url::Url::parse(normalized)
        .map_err(|_| AppError::Validation("Invalid GitHub source link".into()))?;
    let host = url.host_str().unwrap_or("");
    if !host.eq_ignore_ascii_case("github.com") && !host.eq_ignore_ascii_case("www.github.com") {
        return Err(AppError::Validation("Only github.com links are supported".into()));
    }
    let parts: Vec<&str> = url.path_segments().map(|s| s.collect()).unwrap_or_default();
    let parts: Vec<&str> = parts.into_iter().filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return Err(AppError::Validation("Invalid GitHub repository link".into()));
    }
    let owner = parts[0];
    let repo = parts[1].trim_end_matches(".git");
    let mut parsed = ParsedSource {
        repo: format!("{}/{}", owner, repo),
        tag: None,
        asset_name: None,
    };
    if parts.len() >= 5 && parts[2] == "releases" && parts[3] == "tag" {
        parsed.tag = Some(urlencoding::decode(parts[4]).unwrap_or_default().to_string());
        return Ok(parsed);
    }
    if parts.len() >= 6 && parts[2] == "releases" && parts[3] == "download" {
        parsed.tag = Some(urlencoding::decode(parts[4]).unwrap_or_default().to_string());
        parsed.asset_name = Some(parts[5..].join("/"));
        return Ok(parsed);
    }
    Ok(parsed)
}

pub async fn discover_releases(payload: ReleaseDiscoverRequest) -> AppResult<ReleaseDiscoverResult> {
    let parsed = parse_source_link(&payload.source)?;
    let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), false)?;
    let (owner, repo) = parse_repo(&parsed.repo)?;
    let resp = http()
        .get(format!(
            "{}/repos/{}/{}/releases?per_page=30",
            API_BASE, owner, repo
        ))
        .headers(json_headers(token.as_deref()))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to fetch releases: {}",
            read_error(resp).await
        )));
    }
    let items: Vec<ReleaseApiItem> = resp.json().await?;
    let releases = items
        .into_iter()
        .map(|item| ReleaseSummary {
            id: item.id,
            tag: item.tag_name,
            name: item.name.filter(|s| !s.is_empty()),
            draft: item.draft.unwrap_or(false),
            prerelease: item.prerelease.unwrap_or(false),
            published_at: item.published_at,
            assets: item
                .assets
                .unwrap_or_default()
                .into_iter()
                .map(|a| ReleaseAsset {
                    id: a.id,
                    name: a.name,
                    download_url: a.browser_download_url,
                    content_type: a.content_type,
                    size: a.size,
                })
                .collect(),
        })
        .collect();
    Ok(ReleaseDiscoverResult {
        repo: format!("{}/{}", owner, repo),
        suggested_tag: parsed.tag,
        suggested_asset_name: parsed.asset_name,
        releases,
    })
}

pub async fn fetch_release_versions(
    repo: &str,
    token: Option<&str>,
    tag_prefix: Option<&str>,
) -> AppResult<Vec<String>> {
    let (owner, repo_name) = parse_repo(repo)?;
    let resp = http()
        .get(format!(
            "{}/repos/{}/{}/releases?per_page=100",
            API_BASE, owner, repo_name
        ))
        .headers(json_headers(token))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to fetch release versions: {}",
            read_error(resp).await
        )));
    }
    let items: Vec<ReleaseApiItem> = resp.json().await?;
    let semver_re = regex::Regex::new(
        r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$",
    )
    .unwrap();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let mut tag = item.tag_name.trim().to_string();
        if let Some(prefix) = tag_prefix {
            if !tag.starts_with(prefix) {
                continue;
            }
            tag = tag[prefix.len()..].to_string();
        }
        let normalized = tag.trim_start_matches('v').trim().to_string();
        if normalized.is_empty() || !semver_re.is_match(&normalized) {
            continue;
        }
        if seen.insert(normalized.clone()) {
            out.push(normalized);
        }
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseUploadRequest {
    pub repo: String,
    pub tag: String,
    pub file_path: String,
    #[serde(default)]
    pub release_name: Option<String>,
    #[serde(default)]
    pub draft: Option<bool>,
    #[serde(default)]
    pub prerelease: Option<bool>,
    #[serde(default)]
    pub overwrite_asset: Option<bool>,
    #[serde(default)]
    pub create_release_if_missing: Option<bool>,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseUploadResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReleaseInfo {
    id: u64,
    tag_name: String,
    html_url: String,
    upload_url: String,
}

async fn get_or_create_release(
    owner: &str,
    repo: &str,
    token: &str,
    tag: &str,
    release_name: Option<&str>,
    create_if_missing: bool,
    draft: bool,
    prerelease: bool,
    target_branch: Option<&str>,
) -> AppResult<ReleaseInfo> {
    let url = format!(
        "{}/repos/{}/{}/releases/tags/{}",
        API_BASE,
        owner,
        repo,
        urlencoding::encode(tag)
    );
    let resp = http().get(&url).headers(json_headers(Some(token))).send().await?;
    if resp.status().is_success() {
        return Ok(resp.json::<ReleaseInfo>().await?);
    }
    if resp.status() != StatusCode::NOT_FOUND {
        return Err(AppError::GitHub(format!(
            "Failed to fetch release for tag \"{}\": {}",
            tag,
            read_error(resp).await
        )));
    }
    if !create_if_missing {
        return Err(AppError::GitHub(format!(
            "Release tag \"{}\" not found. Enable create release to create it automatically.",
            tag
        )));
    }
    let mut body = serde_json::json!({
        "tag_name": tag,
        "name": release_name.unwrap_or(tag),
        "draft": draft,
        "prerelease": prerelease,
        "generate_release_notes": true,
    });
    if let Some(branch) = target_branch.filter(|s| !s.trim().is_empty()) {
        body["target_commitish"] = serde_json::Value::String(branch.to_string());
    }
    let mut headers = json_headers(Some(token));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let resp = http()
        .post(format!("{}/repos/{}/{}/releases", API_BASE, owner, repo))
        .headers(headers)
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to create release for tag \"{}\": {}",
            tag,
            read_error(resp).await
        )));
    }
    Ok(resp.json::<ReleaseInfo>().await?)
}

async fn remove_existing_asset(
    owner: &str,
    repo: &str,
    release_id: u64,
    asset_name: &str,
    token: &str,
) -> AppResult<()> {
    let resp = http()
        .get(format!(
            "{}/repos/{}/{}/releases/{}/assets?per_page=100",
            API_BASE, owner, repo, release_id
        ))
        .headers(json_headers(Some(token)))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::GitHub(format!(
            "Failed to list existing release assets: {}",
            read_error(resp).await
        )));
    }
    let assets: Vec<ReleaseAssetApi> = resp.json().await?;
    if let Some(existing) = assets.into_iter().find(|a| a.name == asset_name) {
        let resp = http()
            .delete(format!(
                "{}/repos/{}/{}/releases/assets/{}",
                API_BASE, owner, repo, existing.id
            ))
            .headers(json_headers(Some(token)))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to delete existing release asset \"{}\": {}",
                asset_name,
                read_error(resp).await
            )));
        }
    }
    Ok(())
}

pub async fn upload_release_asset(payload: ReleaseUploadRequest) -> ReleaseUploadResult {
    let result: AppResult<ReleaseUploadResult> = (async {
        let repo_input = payload.repo.trim();
        let tag = payload.tag.trim();
        if repo_input.is_empty() {
            return Err(AppError::Validation("Repository cannot be empty".into()));
        }
        if tag.is_empty() {
            return Err(AppError::Validation("Tag cannot be empty".into()));
        }
        let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), true)?
            .ok_or_else(|| AppError::Auth("Token required".into()))?;
        let file_path = payload.file_path.trim();
        if file_path.is_empty() {
            return Err(AppError::Validation("Asset file path cannot be empty".into()));
        }
        let path = std::path::Path::new(file_path);
        let metadata = std::fs::metadata(path)?;
        if !metadata.is_file() {
            return Err(AppError::Validation(format!(
                "Selected path is not a file: {}",
                file_path
            )));
        }
        let (owner, repo) = parse_repo(repo_input)?;
        let release = get_or_create_release(
            &owner,
            &repo,
            &token,
            tag,
            payload.release_name.as_deref(),
            payload.create_release_if_missing.unwrap_or(true),
            payload.draft.unwrap_or(false),
            payload.prerelease.unwrap_or(false),
            payload.target_branch.as_deref(),
        )
        .await?;

        let asset_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| AppError::Validation("Invalid asset file name".into()))?
            .to_string();

        if payload.overwrite_asset.unwrap_or(false) {
            remove_existing_asset(&owner, &repo, release.id, &asset_name, &token).await?;
        }

        let upload_base = release.upload_url.split('{').next().unwrap_or(&release.upload_url);
        let upload_url = format!("{}?name={}", upload_base, urlencoding::encode(&asset_name));
        let bytes = std::fs::read(path)?;

        let mut headers = json_headers(Some(&token));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));

        let resp = http()
            .post(&upload_url)
            .headers(headers)
            .body(bytes)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to upload release asset \"{}\": {}",
                asset_name,
                read_error(resp).await
            )));
        }
        let asset: ReleaseAssetApi = resp.json().await?;
        Ok(ReleaseUploadResult {
            success: true,
            release_id: Some(release.id),
            release_tag: Some(release.tag_name),
            release_url: Some(release.html_url),
            asset_id: Some(asset.id),
            asset_name: Some(asset.name),
            asset_download_url: Some(asset.browser_download_url),
            error: None,
        })
    })
    .await;

    match result {
        Ok(r) => r,
        Err(e) => ReleaseUploadResult {
            success: false,
            release_id: None,
            release_tag: None,
            release_url: None,
            asset_id: None,
            asset_name: None,
            asset_download_url: None,
            error: Some(e.to_string()),
        },
    }
}

// ---------------- Repo file upsert + create-from-folder ----------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoUpsertFileRequest {
    pub repo: String,
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub commit_message: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub overwrite: Option<bool>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoUpsertFileResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContentApi {
    sha: Option<String>,
    path: Option<String>,
    html_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CommitOnlyApi {
    sha: Option<String>,
    html_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertResponse {
    content: Option<ContentApi>,
    commit: Option<CommitOnlyApi>,
}

fn encode_path(p: &str) -> String {
    p.split('/')
        .filter(|s| !s.is_empty())
        .map(|s| urlencoding::encode(s).into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

pub async fn upsert_repo_file(payload: RepoUpsertFileRequest) -> RepoUpsertFileResult {
    let r: AppResult<RepoUpsertFileResult> = (async {
        let repo_in = payload.repo.trim();
        if repo_in.is_empty() {
            return Err(AppError::Validation("Repository is required".into()));
        }
        let path = payload.path.trim().trim_start_matches('/').to_string();
        if path.is_empty() {
            return Err(AppError::Validation("Repository file path is required".into()));
        }
        if payload.content.trim().is_empty() {
            return Err(AppError::Validation("Repository file content cannot be empty".into()));
        }
        let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), true)?
            .ok_or_else(|| AppError::Auth("Token required".into()))?;
        let (owner, repo) = parse_repo(repo_in)?;
        let branch = payload.branch.as_deref().map(str::trim).filter(|s| !s.is_empty());

        // Try to read existing file to find sha
        let mut url = format!(
            "{}/repos/{}/{}/contents/{}",
            API_BASE,
            owner,
            repo,
            encode_path(&path)
        );
        if let Some(b) = branch {
            url.push_str(&format!("?ref={}", urlencoding::encode(b)));
        }
        let existing_sha = match http()
            .get(&url)
            .headers(json_headers(Some(&token)))
            .send()
            .await
        {
            Ok(r) if r.status() == StatusCode::NOT_FOUND => None,
            Ok(r) if r.status().is_success() => {
                let content: ContentApi = r.json().await?;
                content.sha
            }
            Ok(r) => {
                return Err(AppError::GitHub(format!(
                    "Failed to read repository file \"{}\": {}",
                    path,
                    read_error(r).await
                )))
            }
            Err(e) => return Err(AppError::Network(e.to_string())),
        };

        if existing_sha.is_some() && !payload.overwrite.unwrap_or(false) {
            return Err(AppError::Validation(format!(
                "Repository file \"{}\" already exists. Enable overwrite to replace it.",
                path
            )));
        }

        let mut body = serde_json::json!({
            "message": payload.commit_message.unwrap_or_else(|| {
                if existing_sha.is_some() { format!("Update {}", path) } else { format!("Add {}", path) }
            }),
            "content": B64.encode(payload.content.as_bytes()),
        });
        if let Some(b) = branch {
            body["branch"] = serde_json::Value::String(b.to_string());
        }
        if let Some(sha) = existing_sha.as_ref() {
            body["sha"] = serde_json::Value::String(sha.clone());
        }

        let mut headers = json_headers(Some(&token));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let put_url = format!(
            "{}/repos/{}/{}/contents/{}",
            API_BASE,
            owner,
            repo,
            encode_path(&path)
        );
        let resp = http()
            .request(Method::PUT, put_url)
            .headers(headers)
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to write repository file \"{}\": {}",
                path,
                read_error(resp).await
            )));
        }
        let parsed: UpsertResponse = resp.json().await?;
        Ok(RepoUpsertFileResult {
            success: true,
            path: parsed.content.as_ref().and_then(|c| c.path.clone()).or(Some(path)),
            branch: branch.map(str::to_string),
            file_sha: parsed.content.as_ref().and_then(|c| c.sha.clone()),
            commit_sha: parsed.commit.as_ref().and_then(|c| c.sha.clone()),
            html_url: parsed
                .content
                .as_ref()
                .and_then(|c| c.html_url.clone())
                .or_else(|| parsed.commit.as_ref().and_then(|c| c.html_url.clone())),
            created: Some(existing_sha.is_none()),
            error: None,
        })
    })
    .await;
    match r {
        Ok(v) => v,
        Err(e) => RepoUpsertFileResult {
            success: false,
            path: None,
            branch: None,
            file_sha: None,
            commit_sha: None,
            html_url: None,
            created: None,
            error: Some(e.to_string()),
        },
    }
}

// Create repo from local folder: git2 init + add + commit + push, plus REST create.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCreateFromFolderRequest {
    pub folder_path: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub commit_message: Option<String>,
    #[serde(default)]
    pub auto_gitignore: Option<bool>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCreateFromFolderResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<RepoInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

const DEFAULT_GITIGNORE: &[&str] = &[
    "# AutoInstallManager default ignores",
    "node_modules/",
    "vendor/",
    "dist/",
    "build/",
    "out/",
    "target/",
    ".next/",
    ".vite/",
    "coverage/",
    ".venv/",
    "venv/",
    "__pycache__/",
    "*.pyc",
    "*.log",
    "logs/",
    "tmp/",
    ".cache/",
    ".DS_Store",
    "Thumbs.db",
    ".idea/",
    ".vscode/",
    ".env",
    ".env.*",
];

pub async fn create_repo_from_folder(
    payload: RepoCreateFromFolderRequest,
) -> RepoCreateFromFolderResult {
    let folder = payload.folder_path.trim().to_string();
    let mut output: Vec<String> = Vec::new();

    let inner: AppResult<(RepoInfo, String, String)> = (async {
        if folder.is_empty() {
            return Err(AppError::Validation("Folder path is required".into()));
        }
        let folder_path = std::path::Path::new(&folder);
        let metadata = std::fs::metadata(folder_path)?;
        if !metadata.is_dir() {
            return Err(AppError::Validation(format!(
                "Selected path is not a folder: {}",
                folder
            )));
        }
        if folder_path.join(".git").exists() {
            return Err(AppError::Validation(
                "Selected folder already contains a .git repository.".into(),
            ));
        }

        let token = resolve_token(payload.token.as_deref(), payload.account_id.as_deref(), true)?
            .ok_or_else(|| AppError::Auth("Token required".into()))?;

        let repo_name = payload.name.trim();
        if repo_name.is_empty() {
            return Err(AppError::Validation("Repository name cannot be empty".into()));
        }
        if !repo_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        {
            return Err(AppError::Validation(
                "Repository name can only contain letters, numbers, dot, underscore, and hyphen.".into(),
            ));
        }

        let branch = payload
            .branch
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("main")
            .to_string();
        let commit_message = payload
            .commit_message
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Initial commit")
            .to_string();

        if payload.auto_gitignore.unwrap_or(true) {
            let gitignore = folder_path.join(".gitignore");
            if !gitignore.exists() {
                let content = DEFAULT_GITIGNORE.join("\n") + "\n";
                std::fs::write(&gitignore, content)?;
                output.push("Wrote default .gitignore".into());
            }
        }

        let credential = accounts::get_credential(payload.account_id.as_deref())?;
        let user_name = credential
            .as_ref()
            .map(|c| c.username.clone())
            .unwrap_or_else(|| "AutoInstallManager".to_string());
        let user_email = credential
            .as_ref()
            .map(|c| format!("{}@users.noreply.github.com", c.username))
            .unwrap_or_else(|| "autoinstallmanager@users.noreply.github.com".to_string());

        // Create remote first so we can push to it.
        let created = create_repo(RepoCreateRequest {
            name: repo_name.to_string(),
            description: payload.description.clone(),
            visibility: payload.visibility.clone(),
            add_readme: Some(false),
            gitignore_template: None,
            license_template: None,
            private: None,
            auto_init: Some(false),
            token: Some(token.clone()),
            account_id: payload.account_id.clone(),
        })
        .await?;
        output.push(format!("Created GitHub repository: {}", created.full_name));

        let folder_owned = folder_path.to_path_buf();
        let push_url = created.https_url.clone();
        let token_for_push = token.clone();
        let user_name_c = user_name.clone();
        let user_email_c = user_email.clone();
        let branch_c = branch.clone();
        let commit_message_c = commit_message.clone();

        let commit_sha = tokio::task::spawn_blocking(move || -> Result<String, String> {
            let repo = git2::Repository::init(&folder_owned).map_err(|e| e.to_string())?;
            let mut index = repo.index().map_err(|e| e.to_string())?;
            index
                .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
                .map_err(|e| e.to_string())?;
            index.write().map_err(|e| e.to_string())?;
            let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
            let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
            let signature = git2::Signature::now(&user_name_c, &user_email_c)
                .map_err(|e| e.to_string())?;
            let commit_oid = repo
                .commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &commit_message_c,
                    &tree,
                    &[],
                )
                .map_err(|e| e.to_string())?;

            // Rename HEAD if branch isn't 'main'
            let current_branch = repo
                .head()
                .ok()
                .and_then(|r| r.shorthand().map(|s| s.to_string()));
            if current_branch.as_deref() != Some(branch_c.as_str()) {
                repo.set_head(&format!("refs/heads/{}", branch_c))
                    .map_err(|e| e.to_string())?;
            }

            let mut remote = repo
                .remote("origin", &push_url)
                .or_else(|_| repo.find_remote("origin"))
                .map_err(|e| e.to_string())?;

            let mut callbacks = git2::RemoteCallbacks::new();
            let token_owned = token_for_push.clone();
            callbacks.credentials(move |_url, _user, _allowed| {
                git2::Cred::userpass_plaintext("x-access-token", &token_owned)
            });
            let mut push_opts = git2::PushOptions::new();
            push_opts.remote_callbacks(callbacks);
            let refspec = format!("refs/heads/{}:refs/heads/{}", branch_c, branch_c);
            remote
                .push(&[refspec.as_str()], Some(&mut push_opts))
                .map_err(|e| e.to_string())?;
            Ok(commit_oid.to_string())
        })
        .await
        .map_err(|e| AppError::Other(format!("git task failed: {}", e)))?
        .map_err(AppError::Other)?;

        output.push(format!(
            "Created initial commit: {}",
            &commit_sha[..commit_sha.len().min(8)]
        ));
        output.push(format!("Pushed {} to origin.", branch));

        Ok((created, branch, commit_sha))
    })
    .await;

    match inner {
        Ok((repo, branch, commit_sha)) => RepoCreateFromFolderResult {
            success: true,
            repo: Some(repo),
            branch: Some(branch),
            commit_sha: Some(commit_sha),
            folder_path: Some(folder),
            output: Some(output.join("\n")),
            error: None,
        },
        Err(e) => RepoCreateFromFolderResult {
            success: false,
            repo: None,
            branch: None,
            commit_sha: None,
            folder_path: Some(folder),
            output: if output.is_empty() {
                None
            } else {
                Some(output.join("\n"))
            },
            error: Some(e.to_string()),
        },
    }
}

// urlencoding crate alternative — keep things small.
mod urlencoding {
    pub fn encode(s: &str) -> std::borrow::Cow<'_, str> {
        let needs = s
            .bytes()
            .any(|b| !(b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~')));
        if !needs {
            return std::borrow::Cow::Borrowed(s);
        }
        let mut out = String::with_capacity(s.len());
        for b in s.bytes() {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                out.push(b as char);
            } else {
                out.push_str(&format!("%{:02X}", b));
            }
        }
        std::borrow::Cow::Owned(out)
    }
    pub fn decode(s: &str) -> Result<std::borrow::Cow<'_, str>, ()> {
        let bytes = s.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                let hi = (bytes[i + 1] as char).to_digit(16).ok_or(())? as u8;
                let lo = (bytes[i + 2] as char).to_digit(16).ok_or(())? as u8;
                out.push((hi << 4) | lo);
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        String::from_utf8(out)
            .map(std::borrow::Cow::Owned)
            .map_err(|_| ())
    }
}
