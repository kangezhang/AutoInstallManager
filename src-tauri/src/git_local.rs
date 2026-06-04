//! Local Git client.
//!
//! Wraps `git2` to expose a stable, JSON-friendly view of a working
//! repository: status, log, branches, remotes. Plus a small registry of
//! repositories the user has opened, persisted to disk so the renderer
//! can reload them across sessions. Phase 2 adds local mutations
//! (stage / unstage / discard / commit). Network mutations (fetch /
//! pull / push) live in later phases.

use crate::error::{AppError, AppResult};
use crate::paths::app_data_dir;
use git2::{
    BranchType, DiffOptions, ErrorCode, IndexAddOption, Repository, RepositoryState, Sort, Status,
    StatusOptions, build::CheckoutBuilder,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

// ---------------------------------------------------------------- types

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepoEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub last_opened_at: Option<String>,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepoSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub current_branch: Option<String>,
    pub head_sha: Option<String>,
    pub state: String,
    pub ahead: usize,
    pub behind: usize,
    pub upstream: Option<String>,
    pub change_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatus {
    pub head_sha: Option<String>,
    pub current_branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub state: String,
    pub staged: Vec<WorkingChange>,
    pub unstaged: Vec<WorkingChange>,
    pub conflicted: Vec<WorkingChange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCommit {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub author_when: i64,
    pub parent_shas: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBranch {
    pub name: String,
    pub full_name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub target_sha: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRemote {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTag {
    pub name: String,
    pub target_sha: String,
}

// ---------------------------------------------------------------- registry

fn registry_path() -> PathBuf {
    app_data_dir().join("git-local-repos.json")
}

#[derive(Default, Serialize, Deserialize)]
struct RegistryFile {
    repos: Vec<LocalRepoEntry>,
}

pub struct Registry {
    inner: Mutex<RegistryFile>,
}

impl Default for Registry {
    fn default() -> Self {
        Self::load()
    }
}

impl Registry {
    pub fn load() -> Self {
        let path = registry_path();
        let inner = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<RegistryFile>(&bytes).unwrap_or_default(),
            Err(_) => RegistryFile::default(),
        };
        Self {
            inner: Mutex::new(inner),
        }
    }

    fn persist(file: &RegistryFile) -> AppResult<()> {
        let path = registry_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(file)?;
        fs::write(path, bytes)?;
        Ok(())
    }

    pub fn list(&self) -> Vec<LocalRepoEntry> {
        self.inner.lock().unwrap().repos.clone()
    }

    pub fn get(&self, id: &str) -> Option<LocalRepoEntry> {
        self.inner
            .lock()
            .unwrap()
            .repos
            .iter()
            .find(|r| r.id == id)
            .cloned()
    }

    pub fn add(&self, path: PathBuf) -> AppResult<LocalRepoEntry> {
        let canonical = fs::canonicalize(&path)
            .map_err(|e| AppError::NotFound(format!("path not accessible: {}", e)))?;
        // Verify it's a git repo (or contains one).
        let _ = Repository::discover(&canonical)
            .map_err(|e| AppError::Validation(format!("not a git repository: {}", e)))?;
        let path_str = canonical.to_string_lossy().to_string();
        let mut guard = self.inner.lock().unwrap();
        if let Some(existing) = guard.repos.iter().find(|r| r.path == path_str).cloned() {
            return Ok(existing);
        }
        let name = canonical
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "repo".into());
        let entry = LocalRepoEntry {
            id: Uuid::new_v4().to_string(),
            name,
            path: path_str,
            last_opened_at: Some(chrono::Utc::now().to_rfc3339()),
            favorite: false,
        };
        guard.repos.push(entry.clone());
        Self::persist(&guard)?;
        Ok(entry)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let mut guard = self.inner.lock().unwrap();
        guard.repos.retain(|r| r.id != id);
        Self::persist(&guard)?;
        Ok(())
    }

    pub fn touch(&self, id: &str) -> AppResult<()> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(entry) = guard.repos.iter_mut().find(|r| r.id == id) {
            entry.last_opened_at = Some(chrono::Utc::now().to_rfc3339());
            Self::persist(&guard)?;
        }
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> AppResult<()> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(entry) = guard.repos.iter_mut().find(|r| r.id == id) {
            entry.favorite = favorite;
            Self::persist(&guard)?;
        }
        Ok(())
    }

    pub fn rename(&self, id: &str, name: String) -> AppResult<()> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(entry) = guard.repos.iter_mut().find(|r| r.id == id) {
            entry.name = name;
            Self::persist(&guard)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- helpers

fn open_repo_by_id(registry: &Registry, id: &str) -> AppResult<(LocalRepoEntry, Repository)> {
    let entry = registry
        .get(id)
        .ok_or_else(|| AppError::NotFound(format!("local repo not found: {}", id)))?;
    let repo = Repository::open(&entry.path)
        .map_err(|e| AppError::Other(format!("open repo failed: {}", e)))?;
    Ok((entry, repo))
}

fn repo_state_str(state: RepositoryState) -> &'static str {
    match state {
        RepositoryState::Clean => "clean",
        RepositoryState::Merge => "merge",
        RepositoryState::Revert | RepositoryState::RevertSequence => "revert",
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => "cherry-pick",
        RepositoryState::Bisect => "bisect",
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge => "rebase",
        RepositoryState::ApplyMailbox | RepositoryState::ApplyMailboxOrRebase => "apply",
    }
}

fn status_label(s: Status) -> &'static str {
    if s.contains(Status::CONFLICTED) {
        return "conflicted";
    }
    if s.contains(Status::INDEX_NEW) || s.contains(Status::WT_NEW) {
        return "new";
    }
    if s.contains(Status::INDEX_DELETED) || s.contains(Status::WT_DELETED) {
        return "deleted";
    }
    if s.contains(Status::INDEX_RENAMED) || s.contains(Status::WT_RENAMED) {
        return "renamed";
    }
    if s.contains(Status::INDEX_TYPECHANGE) || s.contains(Status::WT_TYPECHANGE) {
        return "typechange";
    }
    if s.contains(Status::INDEX_MODIFIED) || s.contains(Status::WT_MODIFIED) {
        return "modified";
    }
    if s.contains(Status::IGNORED) {
        return "ignored";
    }
    "unchanged"
}

fn current_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if head.is_branch() {
        head.shorthand().map(|s| s.to_string())
    } else {
        None
    }
}

fn upstream_for_head(repo: &Repository) -> AppResult<(Option<String>, usize, usize)> {
    let Some(branch_name) = current_branch_name(repo) else {
        return Ok((None, 0, 0));
    };
    let local = match repo.find_branch(&branch_name, BranchType::Local) {
        Ok(b) => b,
        Err(_) => return Ok((None, 0, 0)),
    };
    let upstream = match local.upstream() {
        Ok(u) => u,
        Err(e) if e.code() == ErrorCode::NotFound => return Ok((None, 0, 0)),
        Err(e) => return Err(e.into()),
    };
    let upstream_name = upstream
        .name()
        .ok()
        .flatten()
        .map(|s| s.to_string());
    let local_oid = local
        .get()
        .target()
        .ok_or_else(|| AppError::Other("local branch has no target".into()))?;
    let upstream_oid = upstream
        .get()
        .target()
        .ok_or_else(|| AppError::Other("upstream has no target".into()))?;
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
    Ok((upstream_name, ahead, behind))
}

// ---------------------------------------------------------------- public API

pub fn summary(registry: &Registry, id: &str) -> AppResult<LocalRepoSummary> {
    let (entry, repo) = open_repo_by_id(registry, id)?;

    let head_sha = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string());
    let current_branch = current_branch_name(&repo);
    let (upstream, ahead, behind) = upstream_for_head(&repo).unwrap_or((None, 0, 0));

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let change_count = statuses
        .iter()
        .filter(|e| {
            !e.status().is_empty() && !e.status().contains(Status::IGNORED)
        })
        .count();

    Ok(LocalRepoSummary {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        current_branch,
        head_sha,
        state: repo_state_str(repo.state()).to_string(),
        ahead,
        behind,
        upstream,
        change_count,
    })
}

pub fn status(registry: &Registry, id: &str) -> AppResult<LocalStatus> {
    let (_entry, repo) = open_repo_by_id(registry, id)?;

    let head_sha = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string());
    let current_branch = current_branch_name(&repo);
    let (upstream, ahead, behind) = upstream_for_head(&repo).unwrap_or((None, 0, 0));

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut conflicted = Vec::new();
    for entry in statuses.iter() {
        let s = entry.status();
        if s.is_empty() || s.contains(Status::IGNORED) {
            continue;
        }
        let path = entry.path().unwrap_or("").to_string();
        if s.contains(Status::CONFLICTED) {
            conflicted.push(WorkingChange {
                path: path.clone(),
                status: "conflicted".into(),
                staged: false,
                conflicted: true,
            });
            continue;
        }
        let index_bits = Status::INDEX_NEW
            | Status::INDEX_MODIFIED
            | Status::INDEX_DELETED
            | Status::INDEX_RENAMED
            | Status::INDEX_TYPECHANGE;
        let wt_bits = Status::WT_NEW
            | Status::WT_MODIFIED
            | Status::WT_DELETED
            | Status::WT_RENAMED
            | Status::WT_TYPECHANGE;
        if s.intersects(index_bits) {
            staged.push(WorkingChange {
                path: path.clone(),
                status: status_label(s & index_bits).to_string(),
                staged: true,
                conflicted: false,
            });
        }
        if s.intersects(wt_bits) {
            unstaged.push(WorkingChange {
                path,
                status: status_label(s & wt_bits).to_string(),
                staged: false,
                conflicted: false,
            });
        }
    }

    Ok(LocalStatus {
        head_sha,
        current_branch,
        upstream,
        ahead,
        behind,
        state: repo_state_str(repo.state()).to_string(),
        staged,
        unstaged,
        conflicted,
    })
}

pub fn log(
    registry: &Registry,
    id: &str,
    branch: Option<String>,
    limit: usize,
) -> AppResult<Vec<LocalCommit>> {
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let limit = limit.min(2000).max(1);

    // Build ref-name index so we can decorate commits with branch/tag tips.
    let mut ref_index: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            if let (Some(name), Some(oid)) = (r.shorthand(), r.target()) {
                ref_index
                    .entry(oid.to_string())
                    .or_default()
                    .push(name.to_string());
            }
        }
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    if let Some(branch) = branch {
        if let Ok(obj) = repo.revparse_single(&branch) {
            walk.push(obj.id())?;
        } else {
            walk.push_head()?;
        }
    } else {
        walk.push_head()?;
    }

    let mut commits = Vec::with_capacity(limit);
    for oid in walk.flatten().take(limit) {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let sha = commit.id().to_string();
        let summary = commit.summary().unwrap_or("").to_string();
        let message = commit.message().unwrap_or("").to_string();
        let author = commit.author();
        commits.push(LocalCommit {
            short_sha: sha[..sha.len().min(8)].to_string(),
            sha,
            summary,
            message,
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            author_when: author.when().seconds(),
            parent_shas: commit.parent_ids().map(|i| i.to_string()).collect(),
            refs: ref_index.get(&commit.id().to_string()).cloned().unwrap_or_default(),
        });
    }
    Ok(commits)
}

pub fn branches(registry: &Registry, id: &str) -> AppResult<Vec<LocalBranch>> {
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let head_branch = current_branch_name(&repo);
    let mut out = Vec::new();
    for branch_result in repo.branches(None)? {
        let (branch, btype) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        let full_name = branch
            .get()
            .name()
            .unwrap_or("")
            .to_string();
        let target_sha = branch.get().target().map(|o| o.to_string());
        let is_remote = matches!(btype, BranchType::Remote);
        let is_head = !is_remote && head_branch.as_deref() == Some(name.as_str());

        let mut upstream_name = None;
        let mut ahead = 0usize;
        let mut behind = 0usize;
        if !is_remote {
            if let Ok(up) = branch.upstream() {
                upstream_name = up.name().ok().flatten().map(|s| s.to_string());
                if let (Some(local_oid), Some(up_oid)) =
                    (branch.get().target(), up.get().target())
                {
                    if let Ok((a, b)) = repo.graph_ahead_behind(local_oid, up_oid) {
                        ahead = a;
                        behind = b;
                    }
                }
            }
        }
        out.push(LocalBranch {
            name,
            full_name,
            is_remote,
            is_head,
            upstream: upstream_name,
            target_sha,
            ahead,
            behind,
        });
    }
    Ok(out)
}

pub fn remotes(registry: &Registry, id: &str) -> AppResult<Vec<LocalRemote>> {
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let names = repo.remotes()?;
    let mut out = Vec::new();
    for name in names.iter().flatten() {
        let remote = match repo.find_remote(name) {
            Ok(r) => r,
            Err(_) => continue,
        };
        out.push(LocalRemote {
            name: name.to_string(),
            fetch_url: remote.url().map(|s| s.to_string()),
            push_url: remote.pushurl().or_else(|| remote.url()).map(|s| s.to_string()),
        });
    }
    Ok(out)
}

pub fn tags(registry: &Registry, id: &str) -> AppResult<Vec<LocalTag>> {
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let mut out = Vec::new();
    let names = repo.tag_names(None)?;
    for n in names.iter().flatten() {
        let full = format!("refs/tags/{}", n);
        if let Ok(reference) = repo.find_reference(&full) {
            if let Some(oid) = reference.target() {
                let target_sha = if let Ok(tag) = repo.find_tag(oid) {
                    tag.target_id().to_string()
                } else {
                    oid.to_string()
                };
                out.push(LocalTag {
                    name: n.to_string(),
                    target_sha,
                });
            }
        }
    }
    Ok(out)
}

pub fn diff_text(
    registry: &Registry,
    id: &str,
    path: &str,
    staged: bool,
) -> AppResult<String> {
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(path).context_lines(3);
    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    let mut buf = String::new();
    diff.print(git2::DiffFormat::Patch, |_d, _h, line| {
        let prefix = match line.origin() {
            '+' | '-' | ' ' => Some(line.origin()),
            _ => None,
        };
        if let Some(p) = prefix {
            buf.push(p);
        }
        if let Ok(s) = std::str::from_utf8(line.content()) {
            buf.push_str(s);
        }
        true
    })?;
    Ok(buf)
}

pub fn discover(path: &Path) -> AppResult<PathBuf> {
    let repo = Repository::discover(path)
        .map_err(|e| AppError::Validation(format!("not a git repo: {}", e)))?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::Validation("bare repos not supported".into()))?;
    Ok(workdir.to_path_buf())
}

// ---------------------------------------------------------------- mutations

/// Stage one or more pathspecs into the index. New / modified / deleted
/// files all go through `add_all`, which respects .gitignore and handles
/// removal of files that no longer exist on disk.
pub fn stage_paths(registry: &Registry, id: &str, paths: Vec<String>) -> AppResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let mut index = repo.index()?;
    index.add_all(paths.iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

/// Stage every change in the working tree.
pub fn stage_all(registry: &Registry, id: &str) -> AppResult<()> {
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

/// Unstage paths — reset their index entries to whatever HEAD points at.
/// Falls back to `index.remove` if the repo has no commits yet.
pub fn unstage_paths(registry: &Registry, id: &str, paths: Vec<String>) -> AppResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    match repo.head() {
        Ok(head) => {
            let obj = head.peel(git2::ObjectType::Commit)?;
            let pathspecs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
            repo.reset_default(Some(&obj), pathspecs.iter())?;
        }
        Err(_) => {
            let mut index = repo.index()?;
            for p in &paths {
                let _ = index.remove_path(Path::new(p));
            }
            index.write()?;
        }
    }
    Ok(())
}

/// Discard working-tree changes for the given paths — restores them to
/// match the index. New files (untracked) get deleted from disk.
pub fn discard_paths(registry: &Registry, id: &str, paths: Vec<String>) -> AppResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let (_entry, repo) = open_repo_by_id(registry, id)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::Validation("bare repos not supported".into()))?
        .to_path_buf();

    // Split into "tracked in index" (checkout) vs "untracked" (delete from disk).
    let index = repo.index()?;
    let mut to_checkout: Vec<String> = Vec::new();
    let mut to_delete: Vec<String> = Vec::new();
    for p in paths {
        if index.get_path(Path::new(&p), 0).is_some() {
            to_checkout.push(p);
        } else {
            to_delete.push(p);
        }
    }
    drop(index);

    if !to_checkout.is_empty() {
        let mut builder = CheckoutBuilder::new();
        builder.force().remove_untracked(false);
        for p in &to_checkout {
            builder.path(p);
        }
        repo.checkout_index(None, Some(&mut builder))?;
    }
    for rel in to_delete {
        let abs = workdir.join(&rel);
        if abs.is_dir() {
            let _ = fs::remove_dir_all(&abs);
        } else if abs.exists() {
            let _ = fs::remove_file(&abs);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    pub message: String,
    /// When true, also stages every change in the working tree before
    /// creating the commit (same as `git commit -a`, plus untracked).
    #[serde(default)]
    pub stage_all: bool,
    /// Override author identity. Falls back to repo / global config.
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    /// When true, allow creating a commit even if the index is empty
    /// or unchanged from HEAD. Defaults to false.
    #[serde(default)]
    pub allow_empty: bool,
}

/// Create a commit from whatever is currently in the index.
pub fn commit(registry: &Registry, id: &str, opts: CommitOptions) -> AppResult<CommitResult> {
    let CommitOptions {
        message,
        stage_all: do_stage_all,
        author_name,
        author_email,
        allow_empty,
    } = opts;

    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("commit message is empty".into()));
    }

    let (_entry, repo) = open_repo_by_id(registry, id)?;

    if do_stage_all {
        let mut index = repo.index()?;
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
        index.write()?;
    }

    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    if !allow_empty {
        match parent_commit.as_ref() {
            Some(parent) => {
                if parent.tree_id() == tree_oid {
                    return Err(AppError::Validation(
                        "no staged changes — nothing to commit".into(),
                    ));
                }
            }
            None => {
                if tree.len() == 0 {
                    return Err(AppError::Validation(
                        "index is empty — nothing to commit".into(),
                    ));
                }
            }
        }
    }

    let sig = match (author_name.as_deref(), author_email.as_deref()) {
        (Some(name), Some(email)) if !name.is_empty() && !email.is_empty() => {
            git2::Signature::now(name, email)?
        }
        _ => repo.signature().map_err(|e| {
            AppError::Validation(format!(
                "no git author configured: set user.name / user.email or pass authorName/authorEmail ({})",
                e
            ))
        })?,
    };

    let oid = repo.commit(Some("HEAD"), &sig, &sig, trimmed, &tree, &parents)?;
    let sha = oid.to_string();
    let short_sha = sha[..sha.len().min(8)].to_string();
    let summary = trimmed.lines().next().unwrap_or("").to_string();
    Ok(CommitResult {
        sha,
        short_sha,
        summary,
    })
}
