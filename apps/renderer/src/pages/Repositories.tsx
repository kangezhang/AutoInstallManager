import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GitHubAccountSummary,
  GitHubCommitInfo,
  GitHubPullRequestInfo,
  GitHubRepoInfo,
  LocalRepoEntry,
} from '@aim/shared';
import { LocalRepoMain, LocalRepoFooter, useLocalRepoState, type LocalBottomTab } from './LocalRepoView';
import { formatDateTime, formatRelative, initialsOf, inferRepoNameFromPath } from './repo-utils';
import { RepoInstallModal } from './RepoInstallModal';
import { useI18n } from '../i18n';
import './Repositories.css';

type DialogKind = 'create' | 'fork' | 'clone' | 'push' | 'pr' | null;
type BottomTab = 'commit' | 'prs' | 'links';
type Selection =
  | { kind: 'remote'; repo: GitHubRepoInfo }
  | { kind: 'local'; entry: LocalRepoEntry }
  | null;

const CACHE_KEY = 'aim.repositories.page.v3';

interface PageCache {
  accounts: GitHubAccountSummary[];
  selectedAccountId: string;
  repoList: GitHubRepoInfo[];
  selectedFullName: string;
}

const readCache = (): PageCache | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PageCache) : null;
  } catch {
    return null;
  }
};

export function Repositories() {
  const { t } = useI18n();
  const [cache] = useState(readCache);
  const [accounts, setAccounts] = useState<GitHubAccountSummary[]>(cache?.accounts ?? []);
  const [selectedAccountId, setSelectedAccountId] = useState(cache?.selectedAccountId ?? '');
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [repoList, setRepoList] = useState<GitHubRepoInfo[]>(cache?.repoList ?? []);
  const [repoListLoading, setRepoListLoading] = useState(false);
  const [search, setSearch] = useState('');

  const [localRepos, setLocalRepos] = useState<LocalRepoEntry[]>([]);
  const [localReposLoading, setLocalReposLoading] = useState(false);

  const [selection, setSelection] = useState<Selection>(() => {
    if (!cache?.selectedFullName) return null;
    const r = cache.repoList?.find((x) => x.fullName === cache.selectedFullName);
    return r ? { kind: 'remote', repo: r } : null;
  });
  const selectedRepo = selection?.kind === 'remote' ? selection.repo : null;
  const selectedLocal = selection?.kind === 'local' ? selection.entry : null;

  const [commits, setCommits] = useState<GitHubCommitInfo[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);

  const [prs, setPrs] = useState<GitHubPullRequestInfo[]>([]);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prState, setPrState] = useState<'open' | 'closed' | 'all'>('open');

  const [bottomTab, setBottomTab] = useState<BottomTab>('commit');
  const [localBottomTab, setLocalBottomTab] = useState<LocalBottomTab>('changes');

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [installModalRepo, setInstallModalRepo] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; repo: GitHubRepoInfo } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const localState = useLocalRepoState(
    selection?.kind === 'local' ? selection.entry : null,
    setError
  );

  // ---- Persist cache ----
  useEffect(() => {
    const snapshot: PageCache = {
      accounts,
      selectedAccountId,
      repoList,
      selectedFullName: selectedRepo?.fullName ?? '',
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  }, [accounts, selectedAccountId, repoList, selectedRepo]);

  // ---- Load accounts ----
  const loadAccounts = useCallback(async () => {
    if (!window.electronAPI?.githubAccount) {
      setError('Tauri runtime not available');
      return;
    }
    setAccountsLoading(true);
    setError(null);
    try {
      const data = await window.electronAPI.githubAccount.list();
      setAccounts(data.accounts);
      setSelectedAccountId((current) => {
        const target = current || data.defaultAccountId || data.accounts[0]?.id || '';
        return data.accounts.some((a) => a.id === target) ? target : '';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // ---- Load local repos ----
  const loadLocalRepos = useCallback(async () => {
    if (!window.electronAPI?.gitLocal) return;
    setLocalReposLoading(true);
    try {
      const list = await window.electronAPI.gitLocal.list();
      setLocalRepos(list as LocalRepoEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load local repos');
    } finally {
      setLocalReposLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocalRepos();
  }, [loadLocalRepos]);

  const openLocalRepo = useCallback(async () => {
    if (!window.electronAPI?.gitLocal) return;
    try {
      const entry = (await window.electronAPI.gitLocal.pickAndAdd()) as
        | LocalRepoEntry
        | null;
      if (entry) {
        await loadLocalRepos();
        setSelection({ kind: 'local', entry });
        setMessage(`Opened ${entry.path}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder');
    }
  }, [loadLocalRepos]);

  const removeLocalRepo = useCallback(
    async (id: string) => {
      if (!window.electronAPI?.gitLocal) return;
      try {
        await window.electronAPI.gitLocal.remove(id);
        if (selection?.kind === 'local' && selection.entry.id === id) {
          setSelection(null);
        }
        await loadLocalRepos();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove');
      }
    },
    [loadLocalRepos, selection]
  );

  // ---- Load repos ----
  const loadRepos = useCallback(async () => {
    if (!window.electronAPI?.githubRepo || !selectedAccountId) {
      setRepoList([]);
      return;
    }
    setRepoListLoading(true);
    setError(null);
    try {
      const repos = await window.electronAPI.githubRepo.listMine({
        accountId: selectedAccountId,
        perPage: 100,
        maxPages: 5,
      });
      setRepoList(repos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repositories');
    } finally {
      setRepoListLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedAccountId && repoList.length === 0) loadRepos();
  }, [selectedAccountId, repoList.length, loadRepos]);

  // ---- Load commits when selected repo changes ----
  const loadCommits = useCallback(
    async (repo: GitHubRepoInfo) => {
      if (!window.electronAPI?.githubRepo) return;
      setCommitsLoading(true);
      setCommits([]);
      setSelectedCommitSha(null);
      try {
        const list = await window.electronAPI.githubRepo.listCommits({
          repo: repo.fullName,
          accountId: selectedAccountId || undefined,
          perPage: 50,
        });
        setCommits(list);
        if (list.length > 0) setSelectedCommitSha(list[0].sha);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/empty|409/i.test(msg)) setError(msg);
      } finally {
        setCommitsLoading(false);
      }
    },
    [selectedAccountId]
  );

  useEffect(() => {
    if (selectedRepo) loadCommits(selectedRepo);
    else {
      setCommits([]);
      setSelectedCommitSha(null);
    }
  }, [selectedRepo, loadCommits]);

  // ---- Load PRs ----
  const loadPRs = useCallback(async () => {
    if (!window.electronAPI?.githubPR || !selectedRepo) return;
    setPrsLoading(true);
    try {
      const list = await window.electronAPI.githubPR.list({
        repo: selectedRepo.fullName,
        state: prState,
        accountId: selectedAccountId || undefined,
      });
      setPrs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PRs');
    } finally {
      setPrsLoading(false);
    }
  }, [selectedRepo, prState, selectedAccountId]);

  useEffect(() => {
    if (bottomTab === 'prs' && selectedRepo) loadPRs();
  }, [bottomTab, selectedRepo, loadPRs]);

  // ---- Filter ----
  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repoList;
    return repoList.filter((r) =>
      `${r.fullName} ${r.description || ''}`.toLowerCase().includes(q)
    );
  }, [search, repoList]);

  const groupedRepos = useMemo(() => {
    const groups = new Map<string, GitHubRepoInfo[]>();
    for (const repo of filteredRepos) {
      const owner = repo.fullName.split('/')[0] || '(unknown)';
      const list = groups.get(owner) ?? [];
      list.push(repo);
      groups.set(owner, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRepos]);

  const filteredLocalRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return localRepos;
    return localRepos.filter((r) => `${r.name} ${r.path}`.toLowerCase().includes(q));
  }, [search, localRepos]);

  const selectedCommit = useMemo(
    () => commits.find((c) => c.sha === selectedCommitSha) ?? null,
    [commits, selectedCommitSha]
  );

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // ---- Dialog close + result handlers ----
  const closeDialog = () => {
    setDialog(null);
    setError(null);
  };

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  const onCreated = async (repo: GitHubRepoInfo) => {
    setMessage(`Created ${repo.fullName}`);
    closeDialog();
    await loadRepos();
    setSelection({ kind: 'remote', repo });
  };

  const [bottomH, setBottomH] = useState(240);
  const appRef = useRef<HTMLDivElement>(null);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomH;
    const onMove = (mv: MouseEvent) => {
      const delta = startY - mv.clientY;
      setBottomH(Math.max(120, Math.min(600, startH + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={appRef}
      className="gf-app"
      style={{ '--bottom-h': `${bottomH}px` } as React.CSSProperties}
    >
      {/* ========== TOP TOOLBAR ========== */}
      <header className="gf-toolbar">
        <div className="gf-toolbar-section">
          <div className="gf-app-title">
            <span className="gf-app-logo">⌥</span>
            {t('repos.title')}
          </div>
          {accounts.length > 0 ? (
            <div className="gf-account-chip">
              <span className="gf-account-avatar">
                {initialsOf(selectedAccount?.displayName)}
              </span>
              <select
                value={selectedAccountId}
                onChange={(e) => {
                  setSelectedAccountId(e.target.value);
                  setRepoList([]);
                  setSelection(null);
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                    {a.isDefault ? ` ${t('repos.accountDefault')}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="gf-toolbar-hint">{t('repos.noAccount')}</span>
          )}
        </div>

        <div className="gf-toolbar-section">
          <ToolbarButton icon="📁" label={t('repos.openFolder')} onClick={openLocalRepo} />
          <span className="gf-toolbar-divider" />
          <ToolbarButton icon="＋" label={t('repos.new')} onClick={() => setDialog('create')} />
          <ToolbarButton icon="⑂" label={t('repos.fork')} onClick={() => setDialog('fork')} />
          <ToolbarButton icon="↓" label={t('repos.clone')} onClick={() => setDialog('clone')} />
          <ToolbarButton icon="↑" label={t('repos.pushFolder')} onClick={() => setDialog('push')} />
          <span className="gf-toolbar-divider" />
          <ToolbarButton
            icon="⇄"
            label={t('repos.pullRequest')}
            disabled={!selectedRepo}
            onClick={() => setDialog('pr')}
          />
          <span className="gf-toolbar-divider" />
          <ToolbarButton
            icon="↻"
            label={t('repos.refresh')}
            onClick={() => {
              loadAccounts();
              loadLocalRepos();
              if (selectedAccountId) loadRepos();
            }}
            disabled={accountsLoading || repoListLoading || localReposLoading}
          />
        </div>
      </header>

      {/* ========== BODY ========== */}
      <div className="gf-body">
        {/* ----- Sidebar tree ----- */}
        <aside className="gf-sidebar">
          <div className="gf-sidebar-search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('repos.filterPlaceholder')}
            />
          </div>
          <div className="gf-tree">
            {/* ---- Local repositories ---- */}
            <div className="gf-tree-group">
              <div className="gf-tree-group-label">
                <span className="gf-caret">▾</span>
                {t('repos.localGroup')}
                <span className="gf-tree-group-count">{filteredLocalRepos.length}</span>
                <button
                  type="button"
                  className="gf-tree-group-action"
                  onClick={openLocalRepo}
                  title={t('repos.openFolderTitle')}
                >
                  +
                </button>
              </div>
              <ul className="gf-tree-list">
                {localReposLoading && filteredLocalRepos.length === 0 && (
                  <li className="gf-tree-empty small">{t('repos.localLoading')}</li>
                )}
                {!localReposLoading && filteredLocalRepos.length === 0 && (
                  <li className="gf-tree-empty small">
                    {t('repos.localEmpty')}
                  </li>
                )}
                {filteredLocalRepos.map((entry) => (
                  <li
                    key={entry.id}
                    className={`gf-tree-item${
                      selectedLocal?.id === entry.id ? ' active' : ''
                    }`}
                    onClick={() => setSelection({ kind: 'local', entry })}
                    title={entry.path}
                  >
                    <span className="gf-repo-icon">📁</span>
                    <span className="gf-tree-item-name">{entry.name}</span>
                    <button
                      type="button"
                      className="gf-tree-item-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            t('repos.removeConfirm').replace('{name}', entry.name)
                          )
                        ) {
                          removeLocalRepo(entry.id);
                        }
                      }}
                      title={t('repos.removeTitle')}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* ---- GitHub remotes ---- */}
            {!selectedAccountId && (
              <div className="gf-tree-empty">
                {t('repos.noAccountHint')}
              </div>
            )}
            {selectedAccountId && repoListLoading && repoList.length === 0 && (
              <div className="gf-tree-empty">{t('repos.reposLoading')}</div>
            )}
            {selectedAccountId && !repoListLoading && filteredRepos.length === 0 && (
              <div className="gf-tree-empty">{t('repos.noRepos')}</div>
            )}
            {groupedRepos.map(([owner, repos]) => (
              <div key={owner} className="gf-tree-group">
                <div className="gf-tree-group-label">
                  <span className="gf-caret">▾</span>
                  {owner}
                  <span className="gf-tree-group-count">{repos.length}</span>
                </div>
                <ul className="gf-tree-list">
                  {repos.map((repo) => (
                    <li
                      key={repo.id}
                      className={`gf-tree-item${
                        selectedRepo?.fullName === repo.fullName ? ' active' : ''
                      }`}
                      onClick={() => setSelection({ kind: 'remote', repo })}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtxMenu({ x: e.clientX, y: e.clientY, repo });
                      }}
                      title={repo.description || repo.fullName}
                    >
                      <span className={`gf-repo-icon${repo.private ? ' private' : ''}`}>
                        {repo.private ? '🔒' : '◇'}
                      </span>
                      <span className="gf-tree-item-name">{repo.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        {/* ----- Main: dispatch local vs remote ----- */}
        {selection?.kind === 'local' ? (
          <LocalRepoMain
            entry={selection.entry}
            state={localState}
            onSwitchBottomTab={setLocalBottomTab}
          />
        ) : (
          <section className="gf-main">
            <div className="gf-main-header">
              {selectedRepo ? (
                <>
                  <div className="gf-main-title">
                    <span className={`gf-repo-icon${selectedRepo.private ? ' private' : ''}`}>
                      {selectedRepo.private ? '🔒' : '◇'}
                    </span>
                    <strong>{selectedRepo.fullName}</strong>
                    {selectedRepo.defaultBranch && (
                      <span className="gf-branch-pill">⎇ {selectedRepo.defaultBranch}</span>
                    )}
                  </div>
                  <div className="gf-main-actions">
                    <a
                      href={selectedRepo.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="gf-link-btn"
                    >
                      {t('repos.openOnGithub')}
                    </a>
                    <button
                      type="button"
                      className="gf-icon-btn"
                      onClick={() => loadCommits(selectedRepo)}
                      disabled={commitsLoading}
                      title={t('repos.refreshCommits')}
                    >
                      ↻
                    </button>
                  </div>
                </>
              ) : (
                <div className="gf-main-title-placeholder">
                  {t('repos.selectRepoHint')}
                </div>
              )}
            </div>

            <div className="gf-commit-table">
              <div className="gf-commit-thead">
                <div className="gf-col-graph">{t('repos.colGraph')}</div>
                <div className="gf-col-message">{t('repos.colDesc')}</div>
                <div className="gf-col-author">{t('repos.colAuthor')}</div>
                <div className="gf-col-date">{t('repos.colDate')}</div>
                <div className="gf-col-sha">{t('repos.colSha')}</div>
              </div>
              <div className="gf-commit-tbody">
                {commitsLoading && (
                  <div className="gf-commit-empty">{t('repos.commitsLoading')}</div>
                )}
                {!commitsLoading && !selectedRepo && (
                  <div className="gf-commit-empty">{t('repos.noRepoSelected')}</div>
                )}
                {!commitsLoading && selectedRepo && commits.length === 0 && (
                  <div className="gf-commit-empty">{t('repos.noCommits')}</div>
                )}
                {commits.map((commit, idx) => (
                  <div
                    key={commit.sha}
                    className={`gf-commit-row${
                      selectedCommitSha === commit.sha ? ' active' : ''
                    }`}
                    onClick={() => {
                      setSelectedCommitSha(commit.sha);
                      setBottomTab('commit');
                    }}
                  >
                    <div className="gf-col-graph">
                      <span className="gf-graph-line" />
                      <span className="gf-graph-dot" />
                      {idx === 0 && <span className="gf-graph-head">{t('repos.headLabel')}</span>}
                    </div>
                    <div className="gf-col-message">
                      {commit.message.split('\n')[0]}
                    </div>
                    <div className="gf-col-author">
                      <span className="gf-author-avatar">
                        {initialsOf(commit.authorName)}
                      </span>
                      {commit.authorName || t('repos.unknownAuthor')}
                    </div>
                    <div className="gf-col-date" title={formatDateTime(commit.date)}>
                      {formatRelative(commit.date)}
                    </div>
                    <div className="gf-col-sha">
                      <code>{commit.sha.slice(0, 8)}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ========== RESIZE HANDLE ========== */}
      <div className="gf-resize-handle" onMouseDown={startResize} role="separator" aria-label="Resize bottom panel" />

      {/* ========== BOTTOM PANEL ========== */}
      {selection?.kind === 'local' ? (
        <LocalRepoFooter
          entryId={selection.entry.id}
          state={localState}
          tab={localBottomTab}
          onTabChange={setLocalBottomTab}
          onAfterAction={(msg) => {
            setMessage(msg);
          }}
        />
      ) : (
        <footer className="gf-bottom">
          <div className="gf-bottom-tabs">
            <button
              type="button"
              className={`gf-bottom-tab${bottomTab === 'commit' ? ' active' : ''}`}
              onClick={() => setBottomTab('commit')}
            >
              {t('repos.tabCommit')}
            </button>
            <button
              type="button"
              className={`gf-bottom-tab${bottomTab === 'prs' ? ' active' : ''}`}
              onClick={() => setBottomTab('prs')}
              disabled={!selectedRepo}
            >
              {t('repos.tabPRs')} {prs.length > 0 && <span className="gf-badge">{prs.length}</span>}
            </button>
            <button
              type="button"
              className={`gf-bottom-tab${bottomTab === 'links' ? ' active' : ''}`}
              onClick={() => setBottomTab('links')}
              disabled={!selectedRepo}
            >
              {t('repos.tabLinks')}
            </button>
          </div>

          <div className="gf-bottom-body">
            {bottomTab === 'commit' && (
              <CommitDetailPane commit={selectedCommit} />
            )}
            {bottomTab === 'prs' && (
              <PrsPane
                prs={prs}
                loading={prsLoading}
                state={prState}
                onStateChange={(s) => setPrState(s)}
                onRefresh={loadPRs}
              />
            )}
            {bottomTab === 'links' && selectedRepo && (
              <LinksPane repo={selectedRepo} />
            )}
          </div>
        </footer>
      )}

      {/* ========== STATUS BAR ========== */}
      {(error || message) && (
        <div className={`gf-statusbar${error ? ' error' : ' ok'}`}>
          <span>{error || message}</span>
          <button
            type="button"
            className="gf-icon-btn"
            onClick={() => {
              setError(null);
              setMessage(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ========== DIALOGS ========== */}
      {dialog === 'create' && (
        <CreateDialog
          accountId={selectedAccountId}
          onClose={closeDialog}
          onCreated={onCreated}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}
      {dialog === 'fork' && (
        <ForkDialog
          accountId={selectedAccountId}
          presetRepo={selectedRepo?.fullName}
          onClose={closeDialog}
          onForked={async (repo) => {
            setMessage(`Forked ${repo.fullName}`);
            closeDialog();
            await loadRepos();
            setSelection({ kind: 'remote', repo });
          }}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}
      {dialog === 'clone' && (
        <CloneDialog
          accountId={selectedAccountId}
          presetRepo={selectedRepo?.fullName}
          onClose={closeDialog}
          onDone={(msg) => {
            setMessage(msg);
            closeDialog();
          }}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}
      {dialog === 'push' && (
        <PushDialog
          accountId={selectedAccountId}
          onClose={closeDialog}
          onDone={async (repo, msg) => {
            setMessage(msg);
            closeDialog();
            await loadRepos();
            setSelection({ kind: 'remote', repo });
          }}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}
      {dialog === 'pr' && selectedRepo && (
        <PrDialog
          accountId={selectedAccountId}
          repo={selectedRepo}
          onClose={closeDialog}
          onCreated={() => {
            setMessage('Pull request created');
            setBottomTab('prs');
            closeDialog();
            loadPRs();
          }}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}

      {accountsLoading && (
        <div className="gf-toast">Loading accounts…</div>
      )}

      {/* Context menu for remote repo items */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="gf-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            type="button"
            className="gf-ctx-menu-item"
            onClick={() => {
              setSelection({ kind: 'remote', repo: ctxMenu.repo });
              setCtxMenu(null);
            }}
          >
            {t('repoInstall.ctxSelect')}
          </button>
          <button
            type="button"
            className="gf-ctx-menu-item"
            onClick={() => {
              setInstallModalRepo(ctxMenu.repo.fullName);
              setCtxMenu(null);
            }}
          >
            {t('repoInstall.ctxInstallTools')}
          </button>
          <div className="gf-ctx-menu-sep" />
          <button
            type="button"
            className="gf-ctx-menu-item"
            onClick={() => {
              setSelection({ kind: 'remote', repo: ctxMenu.repo });
              setDialog('fork');
              setCtxMenu(null);
            }}
          >
            {t('repoInstall.ctxFork')}
          </button>
          <button
            type="button"
            className="gf-ctx-menu-item"
            onClick={() => {
              setSelection({ kind: 'remote', repo: ctxMenu.repo });
              setDialog('clone');
              setCtxMenu(null);
            }}
          >
            {t('repoInstall.ctxClone')}
          </button>
          <button
            type="button"
            className="gf-ctx-menu-item"
            onClick={() => {
              window.open(ctxMenu.repo.htmlUrl, '_blank', 'noopener,noreferrer');
              setCtxMenu(null);
            }}
          >
            {t('repoInstall.ctxOpenGitHub')}
          </button>
        </div>
      )}

      {/* Install tools modal */}
      {installModalRepo && (
        <RepoInstallModal
          repoFullName={installModalRepo}
          accountId={selectedAccountId}
          onClose={() => setInstallModalRepo(null)}
        />
      )}
    </div>
  );
}

/* ============================================================ */
/*  Toolbar button                                                */
/* ============================================================ */

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="gf-tool-btn"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="gf-tool-btn-icon">{icon}</span>
      <span className="gf-tool-btn-label">{label}</span>
    </button>
  );
}

/* ============================================================ */
/*  Bottom panes                                                  */
/* ============================================================ */

function CommitDetailPane({ commit }: { commit: GitHubCommitInfo | null }) {
  const { t } = useI18n();
  if (!commit) {
    return <div className="gf-pane-empty">{t('repos.commitSelectHint')}</div>;
  }
  const lines = commit.message.split('\n');
  const subject = lines[0];
  const body = lines.slice(1).join('\n').trim();
  return (
    <div className="gf-commit-detail">
      <div className="gf-commit-detail-head">
        <code className="gf-commit-detail-sha">{commit.sha}</code>
        <a href={commit.htmlUrl} target="_blank" rel="noreferrer" className="gf-link-btn">
          {t('repos.viewOnGithub')}
        </a>
      </div>
      <h3 className="gf-commit-detail-subject">{subject}</h3>
      {body && <pre className="gf-commit-detail-body">{body}</pre>}
      <div className="gf-commit-detail-meta">
        <div>
          <label>{t('repos.commitAuthor')}</label>
          <span>
            {commit.authorName || t('repos.unknownAuthor')}
            {commit.authorEmail && ` <${commit.authorEmail}>`}
          </span>
        </div>
        <div>
          <label>{t('repos.commitDate')}</label>
          <span>{formatDateTime(commit.date)}</span>
        </div>
      </div>
    </div>
  );
}

function PrsPane({
  prs,
  loading,
  state,
  onStateChange,
  onRefresh,
}: {
  prs: GitHubPullRequestInfo[];
  loading: boolean;
  state: 'open' | 'closed' | 'all';
  onStateChange: (s: 'open' | 'closed' | 'all') => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="gf-prs-pane">
      <div className="gf-prs-toolbar">
        <select value={state} onChange={(e) => onStateChange(e.target.value as 'open' | 'closed' | 'all')}>
          <option value="open">{t('repos.prOpen')}</option>
          <option value="closed">{t('repos.prClosed')}</option>
          <option value="all">{t('repos.prAll')}</option>
        </select>
        <button type="button" className="gf-icon-btn" onClick={onRefresh} disabled={loading}>
          ↻
        </button>
      </div>
      {loading && <div className="gf-pane-empty">{t('repos.prLoading')}</div>}
      {!loading && prs.length === 0 && (
        <div className="gf-pane-empty">{t('repos.prEmpty')}</div>
      )}
      {prs.length > 0 && (
        <ul className="gf-pr-list">
          {prs.map((pr) => (
            <li key={pr.id} className="gf-pr-item">
              <span className={`gf-pr-state state-${pr.state}`}>
                {pr.draft ? t('repos.prDraft') : pr.state}
              </span>
              <strong>#{pr.number}</strong>
              <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                {pr.title}
              </a>
              <span className="gf-pr-branches">
                <code>{pr.head.ref}</code> → <code>{pr.base.ref}</code>
              </span>
              <span className="gf-pr-date">{formatRelative(pr.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinksPane({ repo }: { repo: GitHubRepoInfo }) {
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };
  return (
    <div className="gf-links-pane">
      <LinkRow label="HTTPS" value={repo.httpsUrl} onCopy={() => copy(repo.httpsUrl)} />
      <LinkRow label="SSH" value={repo.sshUrl} onCopy={() => copy(repo.sshUrl)} />
      <LinkRow
        label="Web"
        value={repo.htmlUrl}
        onCopy={() => copy(repo.htmlUrl)}
        href={repo.htmlUrl}
      />
    </div>
  );
}

function LinkRow({
  label,
  value,
  onCopy,
  href,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  href?: string;
}) {
  return (
    <div className="gf-link-row">
      <span className="gf-link-label">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <code>{value}</code>
      )}
      <button type="button" className="gf-icon-btn" onClick={onCopy} title="Copy">
        ⎘
      </button>
    </div>
  );
}

/* ============================================================ */
/*  Modal shell + dialogs                                         */
/* ============================================================ */

function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="gf-modal-backdrop" onClick={onClose}>
      <div className="gf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="gf-modal-head">
          <h3>{title}</h3>
          <button type="button" className="gf-icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="gf-modal-body">{children}</div>
        <footer className="gf-modal-foot">{footer}</footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="gf-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CreateDialog({
  accountId,
  onClose,
  onCreated,
  setError,
  busy,
  setBusy,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: (repo: GitHubRepoInfo) => void;
  setError: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [readme, setReadme] = useState(false);

  const submit = async () => {
    if (!window.electronAPI?.githubRepo) return;
    setBusy(true);
    setError(null);
    try {
      const repo = await window.electronAPI.githubRepo.create({
        name,
        description: description || undefined,
        visibility,
        addReadme: readme,
        accountId: accountId || undefined,
      });
      onCreated(repo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('repos.createTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="gf-btn" onClick={onClose}>
            {t('repos.cancel')}
          </button>
          <button
            type="button"
            className="gf-btn gf-btn-primary"
            disabled={busy || !name.trim() || !accountId}
            onClick={submit}
          >
            {busy ? t('repos.creating') : t('repos.create')}
          </button>
        </>
      }
    >
      <Field label={t('repos.fieldName')}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-new-repo" />
      </Field>
      <Field label={t('repos.fieldVisibility')}>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
        >
          <option value="public">{t('repos.visPublic')}</option>
          <option value="private">{t('repos.visPrivate')}</option>
        </select>
      </Field>
      <Field label={t('repos.fieldDesc')}>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('repoInstall.descriptionPlaceholder')}
        />
      </Field>
      <label className="gf-check">
        <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} />
        {t('repos.initReadme')}
      </label>
    </Modal>
  );
}

function ForkDialog({
  accountId,
  presetRepo,
  onClose,
  onForked,
  setError,
  busy,
  setBusy,
}: {
  accountId: string;
  presetRepo?: string;
  onClose: () => void;
  onForked: (repo: GitHubRepoInfo) => void;
  setError: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState(presetRepo || '');
  const [organization, setOrganization] = useState('');
  const [newName, setNewName] = useState('');
  const [defaultOnly, setDefaultOnly] = useState(false);

  const submit = async () => {
    if (!window.electronAPI?.githubRepo) return;
    setBusy(true);
    setError(null);
    try {
      const forked = await window.electronAPI.githubRepo.fork({
        repo: source,
        organization: organization || undefined,
        name: newName || undefined,
        defaultBranchOnly: defaultOnly || undefined,
        accountId: accountId || undefined,
      });
      onForked(forked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fork');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('repos.forkTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="gf-btn" onClick={onClose}>
            {t('repos.cancel')}
          </button>
          <button
            type="button"
            className="gf-btn gf-btn-primary"
            disabled={busy || !source.trim()}
            onClick={submit}
          >
            {busy ? t('repos.forking') : t('repos.forkBtn')}
          </button>
        </>
      }
    >
      <Field label={t('repos.forkSource')}>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t('repos.forkSourcePH')}
        />
      </Field>
      <Field label={t('repos.forkOrg')}>
        <input
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder={t('repos.forkOrgPH')}
        />
      </Field>
      <Field label={t('repos.forkNewName')}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('repos.forkNewNamePH')}
        />
      </Field>
      <label className="gf-check">
        <input
          type="checkbox"
          checked={defaultOnly}
          onChange={(e) => setDefaultOnly(e.target.checked)}
        />
        {t('repos.forkDefaultOnly')}
      </label>
    </Modal>
  );
}

function CloneDialog({
  accountId,
  presetRepo,
  onClose,
  onDone,
  setError,
  busy,
  setBusy,
}: {
  accountId: string;
  presetRepo?: string;
  onClose: () => void;
  onDone: (msg: string) => void;
  setError: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState(presetRepo || '');
  const [dest, setDest] = useState('');
  const [branch, setBranch] = useState('');
  const [depth, setDepth] = useState('');
  const [output, setOutput] = useState<string | null>(null);

  const pickDest = async () => {
    const path = await window.electronAPI?.githubRepo?.pickCloneDest();
    if (path) setDest(path);
  };

  const submit = async () => {
    if (!window.electronAPI?.githubRepo) return;
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const depthNum = depth.trim() ? parseInt(depth.trim(), 10) : undefined;
      const result = await window.electronAPI.githubRepo.clone({
        repo: source,
        destPath: dest,
        branch: branch || undefined,
        depth: depthNum && !Number.isNaN(depthNum) ? depthNum : undefined,
        accountId: accountId || undefined,
      });
      if (result.success) {
        onDone(`Cloned to ${dest}`);
      } else {
        setOutput(result.output || null);
        setError(result.error || 'Clone failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('repos.cloneTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="gf-btn" onClick={onClose}>
            {t('repos.cancel')}
          </button>
          <button
            type="button"
            className="gf-btn gf-btn-primary"
            disabled={busy || !source.trim() || !dest.trim()}
            onClick={submit}
          >
            {busy ? t('repos.cloning') : t('repos.cloneBtn')}
          </button>
        </>
      }
    >
      <Field label={t('repos.cloneRepo')}>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t('repos.cloneRepoPH')}
        />
      </Field>
      <Field label={t('repos.cloneDest')}>
        <div className="gf-path-row">
          <input
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder={t('repos.cloneDestPH')}
          />
          <button type="button" className="gf-btn" onClick={pickDest}>
            {t('repos.browse')}
          </button>
        </div>
      </Field>
      <div className="gf-grid-2">
        <Field label={t('repos.cloneBranch')}>
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={t('repos.cloneBranchPH')}
          />
        </Field>
        <Field label={t('repos.cloneDepth')}>
          <input
            type="number"
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            placeholder={t('repos.cloneDepthPH')}
            min="1"
          />
        </Field>
      </div>
      {output && <pre className="gf-output">{output}</pre>}
    </Modal>
  );
}

function PushDialog({
  accountId,
  onClose,
  onDone,
  setError,
  busy,
  setBusy,
}: {
  accountId: string;
  onClose: () => void;
  onDone: (repo: GitHubRepoInfo, msg: string) => void;
  setError: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('Initial commit');
  const [autoIgnore, setAutoIgnore] = useState(true);
  const [output, setOutput] = useState<string | null>(null);

  const pickFolder = async () => {
    const path = await window.electronAPI?.githubRepo?.pickLocalFolder();
    if (path) {
      setFolder(path);
      if (!name.trim()) setName(inferRepoNameFromPath(path));
    }
  };

  const submit = async () => {
    if (!window.electronAPI?.githubRepo) return;
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const result = await window.electronAPI.githubRepo.createFromFolder({
        folderPath: folder,
        name,
        description: description || undefined,
        visibility,
        branch: branch || undefined,
        commitMessage: commitMessage || undefined,
        autoGitignore: autoIgnore,
        accountId: accountId || undefined,
      });
      if (result.success && result.repo) {
        onDone(result.repo, `Pushed ${result.repo.fullName}`);
      } else {
        if (result.output) setOutput(result.output);
        setError(result.error || 'Failed to push folder');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to push folder');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('repos.pushTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="gf-btn" onClick={onClose}>
            {t('repos.cancel')}
          </button>
          <button
            type="button"
            className="gf-btn gf-btn-primary"
            disabled={busy || !accountId || !folder.trim() || !name.trim()}
            onClick={submit}
          >
            {busy ? t('repos.pushing') : t('repos.pushBtn')}
          </button>
        </>
      }
    >
      <Field label={t('repos.pushFolder')}>
        <div className="gf-path-row">
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={t('repos.pushFolderPH')}
          />
          <button type="button" className="gf-btn" onClick={pickFolder}>
            {t('repos.browse')}
          </button>
        </div>
      </Field>
      <Field label={t('repos.pushRepoName')}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" />
      </Field>
      <Field label={t('repos.fieldVisibility')}>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
        >
          <option value="public">{t('repos.visPublic')}</option>
          <option value="private">{t('repos.visPrivate')}</option>
        </select>
      </Field>
      <Field label={t('repos.fieldDesc')}>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="gf-grid-2">
        <Field label={t('repos.pushBranch')}>
          <input value={branch} onChange={(e) => setBranch(e.target.value)} />
        </Field>
        <Field label={t('repos.pushCommitMsg')}>
          <input value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} />
        </Field>
      </div>
      <label className="gf-check">
        <input
          type="checkbox"
          checked={autoIgnore}
          onChange={(e) => setAutoIgnore(e.target.checked)}
        />
        {t('repos.pushAutoIgnore')}
      </label>
      {output && <pre className="gf-output">{output}</pre>}
    </Modal>
  );
}

function PrDialog({
  accountId,
  repo,
  onClose,
  onCreated,
  setError,
  busy,
  setBusy,
}: {
  accountId: string;
  repo: GitHubRepoInfo;
  onClose: () => void;
  onCreated: () => void;
  setError: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [head, setHead] = useState('');
  const [base, setBase] = useState(repo.defaultBranch || 'main');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);

  const submit = async () => {
    if (!window.electronAPI?.githubPR) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.githubPR.create({
        repo: repo.fullName,
        title,
        head,
        base,
        body: body || undefined,
        draft,
        accountId: accountId || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PR');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('repos.prTitle').replace('{repo}', repo.fullName)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="gf-btn" onClick={onClose}>
            {t('repos.cancel')}
          </button>
          <button
            type="button"
            className="gf-btn gf-btn-primary"
            disabled={busy || !title.trim() || !head.trim() || !base.trim()}
            onClick={submit}
          >
            {busy ? t('repos.prCreating') : t('repos.prCreateBtn')}
          </button>
        </>
      }
    >
      <Field label={t('repos.prFieldTitle')}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="gf-grid-2">
        <Field label={t('repos.prHeadBranch')}>
          <input
            value={head}
            onChange={(e) => setHead(e.target.value)}
            placeholder={t('repos.prHeadBranchPH')}
          />
        </Field>
        <Field label={t('repos.prBaseBranch')}>
          <input value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
      </div>
      <Field label={t('repos.prBodyField')}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
      </Field>
      <label className="gf-check">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        {t('repos.prDraftCheck')}
      </label>
    </Modal>
  );
}
