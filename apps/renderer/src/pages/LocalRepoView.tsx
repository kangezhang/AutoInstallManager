import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type {
  LocalBranch,
  LocalCommit,
  LocalRemote,
  LocalRepoEntry,
  LocalStatus,
  WorkingChange,
} from '@devstack/shared';
import { formatDateTime, formatRelative, initialsOf } from './repo-utils';

export type LocalBottomTab = 'changes' | 'commit' | 'branches' | 'remotes';

export interface LocalRepoViewState {
  status: LocalStatus | null;
  commits: LocalCommit[];
  branches: LocalBranch[];
  remotes: LocalRemote[];
  selectedSha: string | null;
  selectedChange: WorkingChange | null;
  diff: string;
  diffLoading: boolean;
  loading: boolean;
  refresh: () => void;
  setSelectedSha: (s: string | null) => void;
  setSelectedChange: (c: WorkingChange | null) => void;
}

export function useLocalRepoState(
  entry: LocalRepoEntry | null,
  onError: (msg: string) => void
): LocalRepoViewState {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [commits, setCommits] = useState<LocalCommit[]>([]);
  const [branches, setBranches] = useState<LocalBranch[]>([]);
  const [remotes, setRemotes] = useState<LocalRemote[]>([]);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [selectedChange, setSelectedChange] = useState<WorkingChange | null>(null);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const entryId = entry?.id ?? null;

  const refresh = useCallback(async () => {
    if (!entryId || !window.electronAPI?.gitLocal) return;
    setLoading(true);
    try {
      const [s, c, b, r] = await Promise.all([
        window.electronAPI.gitLocal.status(entryId),
        window.electronAPI.gitLocal.log(entryId, { limit: 200 }),
        window.electronAPI.gitLocal.branches(entryId),
        window.electronAPI.gitLocal.remotes(entryId),
      ]);
      setStatus(s as LocalStatus);
      const list = c as LocalCommit[];
      setCommits(list);
      setBranches(b as LocalBranch[]);
      setRemotes(r as LocalRemote[]);
      setSelectedSha((prev) => prev ?? list[0]?.sha ?? null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [entryId, onError]);

  useEffect(() => {
    setSelectedSha(null);
    setSelectedChange(null);
    setDiff('');
    setStatus(null);
    setCommits([]);
    setBranches([]);
    setRemotes([]);
    if (entryId) refresh();
  }, [entryId, refresh]);

  useEffect(() => {
    if (!selectedChange || !entryId) {
      setDiff('');
      return;
    }
    if (!window.electronAPI?.gitLocal) return;
    let cancelled = false;
    setDiffLoading(true);
    window.electronAPI.gitLocal
      .diff(entryId, selectedChange.path, selectedChange.staged)
      .then((text) => {
        if (!cancelled) setDiff(text as string);
      })
      .catch((err) => {
        if (!cancelled) setDiff(`(diff unavailable: ${err?.message ?? err})`);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChange, entryId]);

  return {
    status,
    commits,
    branches,
    remotes,
    selectedSha,
    selectedChange,
    diff,
    diffLoading,
    loading,
    refresh,
    setSelectedSha,
    setSelectedChange,
  };
}

/* ----------------------------- Main column ----------------------------- */

interface MainProps {
  entry: LocalRepoEntry;
  state: LocalRepoViewState;
  onSwitchBottomTab: (t: LocalBottomTab) => void;
}

export function LocalRepoMain({ entry, state, onSwitchBottomTab }: MainProps) {
  const { status, commits, loading, refresh, selectedSha, setSelectedSha } = state;
  const headBranch = status?.currentBranch ?? null;
  const visibleChangeCount =
    (status?.stagedCount ?? status?.staged.length ?? 0) +
    (status?.unstagedCount ?? status?.unstaged.length ?? 0);
  return (
    <section className="gf-main">
      <div className="gf-main-header">
        <div className="gf-main-title">
          <span className="gf-repo-icon">📁</span>
          <strong>{entry.name}</strong>
          {headBranch && (
            <span className="gf-branch-pill">⎇ {headBranch}</span>
          )}
          {status && (
            <>
              {status.ahead > 0 && (
                <span className="gf-pill ahead">↑ {status.ahead}</span>
              )}
              {status.behind > 0 && (
                <span className="gf-pill behind">↓ {status.behind}</span>
              )}
              {visibleChangeCount > 0 && (
                <span className="gf-pill changes">
                  ● {status.staged.length + status.unstaged.length}
                </span>
              )}
              {status.state !== 'clean' && (
                <span className="gf-pill state">{status.state}</span>
              )}
            </>
          )}
        </div>
        <div className="gf-main-actions">
          <span className="gf-path-text" title={entry.path}>
            {entry.path}
          </span>
          <button
            type="button"
            className="gf-icon-btn"
            onClick={refresh}
            disabled={loading}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="gf-commit-table">
        <div className="gf-commit-thead">
          <div className="gf-col-graph">Graph</div>
          <div className="gf-col-message">Description</div>
          <div className="gf-col-author">Author</div>
          <div className="gf-col-date">Date</div>
          <div className="gf-col-sha">SHA</div>
        </div>
        <div className="gf-commit-tbody">
          {loading && commits.length === 0 && (
            <div className="gf-commit-empty">Loading commits…</div>
          )}
          {!loading && commits.length === 0 && (
            <div className="gf-commit-empty">No commits.</div>
          )}
          {commits.map((commit, idx) => (
            <div
              key={commit.sha}
              className={`gf-commit-row${selectedSha === commit.sha ? ' active' : ''}`}
              onClick={() => {
                setSelectedSha(commit.sha);
                onSwitchBottomTab('commit');
              }}
            >
              <div className="gf-col-graph">
                <span className="gf-graph-line" />
                <span className="gf-graph-dot" />
              </div>
              <div className="gf-col-message">
                {idx === 0 && <span className="gf-graph-head">HEAD</span>}
                {commit.refs.length > 0 && (
                  <span className="gf-ref-tags">
                    {commit.refs.map((r) => (
                      <span
                        key={r}
                        className={`gf-ref-tag${r.includes('/') ? ' remote' : ''}`}
                      >
                        {r}
                      </span>
                    ))}
                  </span>
                )}
                {commit.summary || '(no message)'}
              </div>
              <div className="gf-col-author">
                <span className="gf-author-avatar">{initialsOf(commit.authorName)}</span>
                {commit.authorName || 'Unknown'}
              </div>
              <div className="gf-col-date" title={formatDateTime(commit.authorWhen)}>
                {formatRelative(commit.authorWhen)}
              </div>
              <div className="gf-col-sha">
                <code>{commit.shortSha}</code>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Bottom panel ----------------------------- */

interface FooterProps {
  entryId: string;
  state: LocalRepoViewState;
  tab: LocalBottomTab;
  onTabChange: (t: LocalBottomTab) => void;
  onAfterAction: (msg: string) => void;
}

export function LocalRepoFooter({
  entryId,
  state,
  tab,
  onTabChange,
  onAfterAction,
}: FooterProps) {
  const {
    status,
    commits,
    branches,
    remotes,
    selectedSha,
    selectedChange,
    diff,
    diffLoading,
    setSelectedChange,
    refresh,
  } = state;
  const selectedCommit = commits.find((c) => c.sha === selectedSha) ?? null;
  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);
  const totalChanges =
    (status?.stagedCount ?? status?.staged.length ?? 0) +
    (status?.unstagedCount ?? status?.unstaged.length ?? 0) +
    (status?.conflictedCount ?? status?.conflicted.length ?? 0);

  return (
    <footer className="gf-bottom local">
      <div className="gf-bottom-tabs">
        <button
          type="button"
          className={`gf-bottom-tab${tab === 'changes' ? ' active' : ''}`}
          onClick={() => onTabChange('changes')}
        >
          Changes
          {totalChanges > 0 && <span className="gf-badge">{totalChanges}</span>}
        </button>
        <button
          type="button"
          className={`gf-bottom-tab${tab === 'commit' ? ' active' : ''}`}
          onClick={() => onTabChange('commit')}
        >
          Commit Detail
        </button>
        <button
          type="button"
          className={`gf-bottom-tab${tab === 'branches' ? ' active' : ''}`}
          onClick={() => onTabChange('branches')}
        >
          Branches
          <span className="gf-badge">{branches.length}</span>
        </button>
        <button
          type="button"
          className={`gf-bottom-tab${tab === 'remotes' ? ' active' : ''}`}
          onClick={() => onTabChange('remotes')}
        >
          Remotes
          <span className="gf-badge">{remotes.length}</span>
        </button>
      </div>
      <div className="gf-bottom-body local">
        {tab === 'changes' && (
          <ChangesPane
            entryId={entryId}
            status={status}
            selected={selectedChange}
            onSelect={setSelectedChange}
            diff={diff}
            diffLoading={diffLoading}
            onAction={onAfterAction}
            refresh={refresh}
          />
        )}
        {tab === 'commit' && <CommitDetailLocal commit={selectedCommit} />}
        {tab === 'branches' && (
          <BranchesPane local={localBranches} remote={remoteBranches} />
        )}
        {tab === 'remotes' && <RemotesPane remotes={remotes} />}
      </div>
    </footer>
  );
}

/* ----------------------------- Inner panes ----------------------------- */

type ActionKind = 'stage' | 'unstage' | 'discard';

async function runAction(
  kind: ActionKind | 'stageAll',
  entryId: string,
  paths: string[]
): Promise<void> {
  const api = window.electronAPI?.gitLocal;
  if (!api) throw new Error('Tauri runtime not available');
  if (kind === 'stageAll') return api.stageAll(entryId);
  if (kind === 'stage') return api.stage(entryId, paths);
  if (kind === 'unstage') return api.unstage(entryId, paths);
  return api.discard(entryId, paths);
}

function ChangesPane({
  entryId,
  status,
  selected,
  onSelect,
  diff,
  diffLoading,
  onAction,
  refresh,
}: {
  entryId: string;
  status: LocalStatus | null;
  selected: WorkingChange | null;
  onSelect: (c: WorkingChange | null) => void;
  diff: string;
  diffLoading: boolean;
  onAction: (msg: string) => void;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [stageBeforeCommit, setStageBeforeCommit] = useState(false);
  const [listW, setListW] = useState(280);

  const startHResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listW;
    const onMove = (mv: MouseEvent) => {
      setListW(Math.max(160, Math.min(520, startW + mv.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [listW]);

  const totalChanges =
    (status?.stagedCount ?? status?.staged.length ?? 0) +
    (status?.unstagedCount ?? status?.unstaged.length ?? 0) +
    (status?.conflictedCount ?? status?.conflicted.length ?? 0);
  const stagedCount = status?.stagedCount ?? status?.staged.length ?? 0;
  const unstagedCount = status?.unstagedCount ?? status?.unstaged.length ?? 0;
  const conflictedCount = status?.conflictedCount ?? status?.conflicted.length ?? 0;
  const stagedOmitted = status?.stagedOmitted ?? 0;
  const unstagedOmitted = status?.unstagedOmitted ?? 0;
  const conflictedOmitted = status?.conflictedOmitted ?? 0;
  const hasStaged = stagedCount > 0;
  const hasUnstaged = unstagedCount > 0;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  const fire = useCallback(
    async (
      kind: ActionKind | 'stageAll',
      paths: string[],
      done: string,
      clearSelectionFor?: WorkingChange
    ) => {
      if (busy) return;
      setBusy(true);
      try {
        await runAction(kind, entryId, paths);
        if (clearSelectionFor && selected?.path === clearSelectionFor.path) {
          onSelect(null);
        }
        onAction(done);
        refresh();
      } catch (err) {
        onAction(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, entryId, onAction, onSelect, refresh, selected]
  );

  const commit = useCallback(async () => {
    if (busy) return;
    const trimmed = message.trim();
    if (!trimmed) { onAction('Commit message is empty.'); return; }
    if (!stageBeforeCommit && !hasStaged) {
      onAction('Nothing staged. Stage files first or enable "stage all".');
      return;
    }
    const api = window.electronAPI?.gitLocal;
    if (!api) { onAction('Tauri runtime not available'); return; }
    setBusy(true);
    try {
      const result = (await api.commit(entryId, {
        message: trimmed,
        stageAll: stageBeforeCommit,
      })) as { shortSha?: string };
      onAction(`Committed ${result?.shortSha ?? ''}`.trim());
      setMessage('');
      setStageBeforeCommit(false);
      refresh();
    } catch (err) {
      onAction(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, entryId, hasStaged, message, onAction, refresh, stageBeforeCommit]);

  const push = useCallback(async () => {
    if (networkBusy) return;
    const api = window.electronAPI?.gitLocal;
    if (!api) { onAction('Tauri runtime not available'); return; }
    setNetworkBusy(true);
    setNetworkStatus('Pushing…');
    try {
      const result = await api.push(entryId);
      if (result?.success) {
        setNetworkStatus(result.output || 'Pushed.');
        onAction(result.output || 'Pushed to remote.');
        refresh();
      } else {
        setNetworkStatus(null);
        onAction(result?.error || 'Push failed');
      }
    } catch (err) {
      setNetworkStatus(null);
      onAction(err instanceof Error ? err.message : String(err));
    } finally {
      setNetworkBusy(false);
    }
  }, [networkBusy, entryId, onAction, refresh]);

  const pull = useCallback(async () => {
    if (networkBusy) return;
    const api = window.electronAPI?.gitLocal;
    if (!api) { onAction('Tauri runtime not available'); return; }
    setNetworkBusy(true);
    setNetworkStatus('Pulling…');
    try {
      const result = await api.pull(entryId);
      if (result?.success) {
        setNetworkStatus(result.output || 'Up to date.');
        onAction(result.output || 'Pulled from remote.');
        refresh();
      } else {
        setNetworkStatus(null);
        onAction(result?.error || 'Pull failed');
      }
    } catch (err) {
      setNetworkStatus(null);
      onAction(err instanceof Error ? err.message : String(err));
    } finally {
      setNetworkBusy(false);
    }
  }, [networkBusy, entryId, onAction, refresh]);

  const networkBar = (
    <div className="gf-network-bar">
      <button
        type="button"
        className="gf-mini-btn"
        disabled={networkBusy || behind === 0}
        onClick={pull}
        title={behind > 0 ? `Pull ${behind} commit(s) from remote` : 'Nothing to pull'}
      >
        {networkBusy && networkStatus?.startsWith('Pull') ? '↓ Pulling…' : `↓ Pull${behind > 0 ? ` ${behind}` : ''}`}
      </button>
      <button
        type="button"
        className="gf-mini-btn primary"
        disabled={networkBusy || ahead === 0}
        onClick={push}
        title={ahead > 0 ? `Push ${ahead} commit(s) to remote` : 'Nothing to push'}
      >
        {networkBusy && networkStatus?.startsWith('Push') ? '↑ Pushing…' : `↑ Push${ahead > 0 ? ` ${ahead}` : ''}`}
      </button>
      {networkBusy && (
        <span className="gf-network-progress">
          <span className="gf-spinner" /> {networkStatus}
        </span>
      )}
      {!networkBusy && networkStatus && (
        <span className="gf-network-done" onClick={() => setNetworkStatus(null)}>
          {networkStatus} ✕
        </span>
      )}
    </div>
  );

  if (!status) return <div className="gf-pane-empty">Loading…</div>;

  if (totalChanges === 0) {
    return (
      <div className="gf-changes-layout" style={{ '--changes-list-w': `${listW}px` } as never}>
        <div className="gf-changes-list">
          <div className="gf-pane-empty">Working tree clean.</div>
        </div>
        <div className="gf-changes-h-resize" onMouseDown={startHResize} role="separator" />
        <div className="gf-diff-pane">
          {networkBar}
        </div>
      </div>
    );
  }

  return (
    <div className="gf-changes-layout" style={{ '--changes-list-w': `${listW}px` } as never}>
      <div className="gf-changes-list">
        <div className="gf-changes-toolbar">
          <button
            type="button"
            className="gf-mini-btn"
            disabled={busy || !hasUnstaged}
            onClick={() => fire('stageAll', [], 'Staged all changes')}
          >
            Stage all
          </button>
          <button
            type="button"
            className="gf-mini-btn"
            disabled={busy || !hasStaged}
            onClick={() =>
              fire(
                'unstage',
                (status?.staged ?? []).map((c) => c.path),
                stagedOmitted > 0 ? 'Unstaged visible files' : 'Unstaged all'
              )
            }
          >
            {stagedOmitted > 0 ? 'Unstage shown' : 'Unstage all'}
          </button>
        </div>
        {conflictedCount > 0 && (
          <Section title={`Conflicts (${conflictedCount})`} emphasis="danger">
            {status.conflicted.map((c) => (
              <ChangeRow
                key={`con-${c.path}`}
                change={c}
                active={selected?.path === c.path}
                busy={busy}
                onClick={() => onSelect(c)}
              />
            ))}
            {conflictedOmitted > 0 && (
              <div className="gf-pane-empty small">
                {conflictedOmitted} more hidden to keep the list responsive.
              </div>
            )}
          </Section>
        )}
        <Section title={`Staged (${stagedCount})`}>
          {stagedCount === 0 && (
            <div className="gf-pane-empty small">Nothing staged.</div>
          )}
          {status.staged.map((c) => (
            <ChangeRow
              key={`s-${c.path}`}
              change={c}
              active={selected?.path === c.path && !!selected?.staged}
              busy={busy}
              onClick={() => onSelect(c)}
              actions={[
                {
                  label: 'Unstage',
                  onClick: () => fire('unstage', [c.path], `Unstaged ${c.path}`, c),
                },
              ]}
            />
          ))}
          {stagedOmitted > 0 && (
            <div className="gf-pane-empty small">
              {stagedOmitted} more hidden to keep the list responsive.
            </div>
          )}
        </Section>
        <Section title={`Unstaged (${unstagedCount})`}>
          {unstagedCount === 0 && (
            <div className="gf-pane-empty small">No unstaged changes.</div>
          )}
          {status.unstaged.map((c) => (
            <ChangeRow
              key={`u-${c.path}`}
              change={c}
              active={selected?.path === c.path && !selected?.staged}
              busy={busy}
              onClick={() => onSelect(c)}
              actions={[
                {
                  label: 'Stage',
                  onClick: () => fire('stage', [c.path], `Staged ${c.path}`),
                },
                {
                  label: 'Discard',
                  variant: 'danger',
                  onClick: () => {
                    const ok = window.confirm(
                      `Discard local changes to ${c.path}?\n\nThis cannot be undone.`
                    );
                    if (ok) fire('discard', [c.path], `Discarded ${c.path}`, c);
                  },
                },
              ]}
            />
          ))}
          {unstagedOmitted > 0 && (
            <div className="gf-pane-empty small">
              {unstagedOmitted} more hidden to keep the list responsive.
            </div>
          )}
        </Section>
      </div>
      <div className="gf-changes-h-resize" onMouseDown={startHResize} role="separator" />
      <div className="gf-diff-pane">
        {!selected && <div className="gf-pane-empty">Select a file to see its diff.</div>}
        {selected && (
          <>
            <div className="gf-diff-head">
              <span className={`gf-status-tag ${selected.status}`}>
                {selected.staged ? '●' : '○'} {selected.status}
              </span>
              <code>{selected.path}</code>
              <span className="gf-spacer" />
              {!selected.staged && (
                <button
                  type="button"
                  className="gf-mini-btn"
                  disabled={busy}
                  onClick={() => fire('stage', [selected.path], `Staged ${selected.path}`)}
                >
                  Stage file
                </button>
              )}
              {selected.staged && (
                <button
                  type="button"
                  className="gf-mini-btn"
                  disabled={busy}
                  onClick={() => fire('unstage', [selected.path], `Unstaged ${selected.path}`, selected)}
                >
                  Unstage file
                </button>
              )}
            </div>
            <pre className="gf-diff-body">
              {diffLoading ? 'Loading diff…' : diff || '(empty diff)'}
            </pre>
          </>
        )}
        <div className="gf-commit-box">
          <textarea
            className="gf-commit-message"
            value={message}
            placeholder={hasStaged ? 'Commit message' : 'Stage files, then write a commit message'}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
          />
          <div className="gf-commit-actions">
            <label className="gf-commit-checkbox">
              <input
                type="checkbox"
                checked={stageBeforeCommit}
                onChange={(e) => setStageBeforeCommit(e.target.checked)}
              />
              Stage all before commit
            </label>
            <button
              type="button"
              className="gf-mini-btn primary"
              disabled={busy || !message.trim() || (!hasStaged && !stageBeforeCommit)}
              onClick={commit}
            >
              Commit
            </button>
          </div>
          {networkBar}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  emphasis,
  children,
}: {
  title: string;
  emphasis?: 'danger';
  children: React.ReactNode;
}) {
  return (
    <div className="gf-changes-section">
      <div
        className={`gf-changes-section-title${emphasis === 'danger' ? ' danger' : ''}`}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

interface RowAction {
  label: string;
  onClick: () => void;
  variant?: 'danger';
}

function ChangeRow({
  change,
  active,
  busy,
  onClick,
  actions,
}: {
  change: WorkingChange;
  active: boolean;
  busy?: boolean;
  onClick: () => void;
  actions?: RowAction[];
}) {
  return (
    <div
      className={`gf-change-row${active ? ' active' : ''}`}
      onClick={onClick}
      title={change.path}
    >
      <span className={`gf-status-mark ${change.status}`} title={change.status}>
        {markFor(change.status)}
      </span>
      <span className="gf-change-path">{change.path}</span>
      {actions && actions.length > 0 && (
        <span className="gf-change-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`gf-row-action${a.variant === 'danger' ? ' danger' : ''}`}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function markFor(status: string): string {
  switch (status) {
    case 'new':
      return 'A';
    case 'modified':
      return 'M';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'typechange':
      return 'T';
    case 'conflicted':
      return '!';
    default:
      return '?';
  }
}

function CommitDetailLocal({ commit }: { commit: LocalCommit | null }) {
  if (!commit) return <div className="gf-pane-empty">Select a commit.</div>;
  const lines = commit.message.split('\n');
  const subject = lines[0] || commit.summary;
  const body = lines.slice(1).join('\n').trim();
  return (
    <div className="gf-commit-detail">
      <div className="gf-commit-detail-head">
        <code className="gf-commit-detail-sha">{commit.sha}</code>
        {commit.refs.length > 0 && (
          <span className="gf-ref-tags">
            {commit.refs.map((r) => (
              <span key={r} className={`gf-ref-tag${r.includes('/') ? ' remote' : ''}`}>
                {r}
              </span>
            ))}
          </span>
        )}
      </div>
      <h3 className="gf-commit-detail-subject">{subject}</h3>
      {body && <pre className="gf-commit-detail-body">{body}</pre>}
      <div className="gf-commit-detail-meta">
        <div>
          <label>Author</label>
          <span>
            {commit.authorName} {commit.authorEmail && <>&lt;{commit.authorEmail}&gt;</>}
          </span>
        </div>
        <div>
          <label>Date</label>
          <span>{formatDateTime(commit.authorWhen)}</span>
        </div>
        <div>
          <label>Parents</label>
          <span>
            {commit.parentShas.length > 0
              ? commit.parentShas.map((p) => p.slice(0, 8)).join(', ')
              : '(root)'}
          </span>
        </div>
      </div>
    </div>
  );
}

function BranchesPane({
  local,
  remote,
}: {
  local: LocalBranch[];
  remote: LocalBranch[];
}) {
  return (
    <div className="gf-branches-pane">
      <div className="gf-branches-col">
        <h4>Local ({local.length})</h4>
        <ul>
          {local.map((b) => (
            <li key={b.fullName} className={b.isHead ? 'head' : ''}>
              <span className="gf-branch-icon">⎇</span>
              <span className="gf-branch-name">{b.name}</span>
              {b.isHead && <span className="gf-pill state">HEAD</span>}
              {b.upstream && (
                <span className="gf-branch-upstream" title={b.upstream}>
                  → {b.upstream}
                </span>
              )}
              {(b.ahead > 0 || b.behind > 0) && (
                <span className="gf-branch-counts">
                  {b.ahead > 0 && <span className="gf-pill ahead">↑{b.ahead}</span>}
                  {b.behind > 0 && <span className="gf-pill behind">↓{b.behind}</span>}
                </span>
              )}
            </li>
          ))}
          {local.length === 0 && <li className="gf-pane-empty small">None.</li>}
        </ul>
      </div>
      <div className="gf-branches-col">
        <h4>Remote ({remote.length})</h4>
        <ul>
          {remote.map((b) => (
            <li key={b.fullName}>
              <span className="gf-branch-icon">⌂</span>
              <span className="gf-branch-name">{b.name}</span>
            </li>
          ))}
          {remote.length === 0 && <li className="gf-pane-empty small">None.</li>}
        </ul>
      </div>
    </div>
  );
}

function RemotesPane({ remotes }: { remotes: LocalRemote[] }) {
  if (remotes.length === 0) {
    return <div className="gf-pane-empty">No remotes configured.</div>;
  }
  return (
    <ul className="gf-remotes-pane">
      {remotes.map((r) => (
        <li key={r.name}>
          <strong>{r.name}</strong>
          <div className="gf-link-row">
            <span className="gf-link-label">Fetch</span>
            <code>{r.fetchUrl || '-'}</code>
          </div>
          <div className="gf-link-row">
            <span className="gf-link-label">Push</span>
            <code>{r.pushUrl || '-'}</code>
          </div>
        </li>
      ))}
    </ul>
  );
}
