import { useCallback, useEffect, useState } from 'react';
import type { GitHubAccountSummary, GitHubCommitInfo, GitHubRepoInfo } from '@aim/shared';
import { IconButton } from '../components/ui/IconButton';
import './Repositories.css';

const GITIGNORE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'No .gitignore', value: '' },
  { label: 'Node', value: 'Node' },
  { label: 'Python', value: 'Python' },
  { label: 'Go', value: 'Go' },
  { label: 'Rust', value: 'Rust' },
  { label: 'Java', value: 'Java' },
  { label: 'C++', value: 'C++' },
  { label: 'VisualStudioCode', value: 'VisualStudioCode' },
];

const LICENSE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'No license', value: '' },
  { label: 'MIT', value: 'mit' },
  { label: 'Apache 2.0', value: 'apache-2.0' },
  { label: 'GPL v3.0', value: 'gpl-3.0' },
  { label: 'BSD 3-Clause', value: 'bsd-3-clause' },
  { label: 'Unlicense', value: 'unlicense' },
];

const REPOSITORIES_CACHE_KEY = 'aim.repositories.page.v1';

interface RepositoriesPageCache {
  accountsLoaded: boolean;
  githubAccounts: GitHubAccountSummary[];
  githubSelectedId: string;
  repoList: GitHubRepoInfo[];
  repoSelectedFullName: string;
  repoInfo: GitHubRepoInfo | null;
  repoCommits: GitHubCommitInfo[];
  repoMessage: string | null;
}

const readRepositoriesCache = (): RepositoriesPageCache | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(REPOSITORIES_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RepositoriesPageCache;
  } catch {
    return null;
  }
};

export function Repositories() {
  const [cache] = useState<RepositoriesPageCache | null>(() => readRepositoriesCache());
  const [githubAccounts, setGitHubAccounts] = useState<GitHubAccountSummary[]>(
    cache?.githubAccounts || []
  );
  const [githubSelectedId, setGitHubSelectedId] = useState<string>(cache?.githubSelectedId || '');
  const [accountsLoaded, setAccountsLoaded] = useState(Boolean(cache?.accountsLoaded));
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [repoList, setRepoList] = useState<GitHubRepoInfo[]>(cache?.repoList || []);
  const [repoListLoading, setRepoListLoading] = useState(false);
  const [repoSelectedFullName, setRepoSelectedFullName] = useState(cache?.repoSelectedFullName || '');
  const [commitLoading, setCommitLoading] = useState(false);
  const [repoCreateName, setRepoCreateName] = useState('');
  const [repoCreateDescription, setRepoCreateDescription] = useState('');
  const [repoCreateVisibility, setRepoCreateVisibility] = useState<'public' | 'private'>('public');
  const [repoCreateAddReadme, setRepoCreateAddReadme] = useState(false);
  const [repoCreateGitignore, setRepoCreateGitignore] = useState('');
  const [repoCreateLicense, setRepoCreateLicense] = useState('');
  const [repoInfo, setRepoInfo] = useState<GitHubRepoInfo | null>(cache?.repoInfo || null);
  const [repoCommits, setRepoCommits] = useState<GitHubCommitInfo[]>(cache?.repoCommits || []);
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoMessage, setRepoMessage] = useState<string | null>(cache?.repoMessage || null);

  const loadGitHubAccounts = useCallback(async (preferredSelectedId?: string) => {
    if (!window.electronAPI?.githubAccount) {
      setRepoError('Electron API is not available');
      return;
    }

    setAccountsLoading(true);
    setAccountsLoaded(true);
    setRepoError(null);
    try {
      const data = await window.electronAPI.githubAccount.list();
      setGitHubAccounts(data.accounts);
      if (data.accounts.length === 0) {
        setRepoList([]);
        setRepoSelectedFullName('');
        setRepoInfo(null);
        setRepoCommits([]);
      }
      setGitHubSelectedId((current) => {
        const target = preferredSelectedId || current || data.defaultAccountId || data.accounts[0]?.id || '';
        return data.accounts.some((account) => account.id === target) ? target : '';
      });
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : 'Failed to load GitHub accounts');
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const loadMineRepositories = useCallback(
    async (accountIdOverride?: string) => {
      if (!window.electronAPI?.githubRepo) return;

      const targetAccountId = (accountIdOverride || githubSelectedId || '').trim();
      if (!targetAccountId) {
        setRepoList([]);
        setRepoSelectedFullName('');
        setRepoInfo(null);
        setRepoCommits([]);
        return;
      }

      setRepoListLoading(true);
      setRepoError(null);
      try {
        const repositories = await window.electronAPI.githubRepo.listMine({
          accountId: targetAccountId,
          perPage: 100,
          maxPages: 5,
        });
        setRepoList(repositories);
        setRepoSelectedFullName((current) => {
          if (current && repositories.some((item) => item.fullName === current)) {
            return current;
          }
          return repositories[0]?.fullName || '';
        });
        setRepoInfo((current) => {
          if (current) {
            const matched = repositories.find((item) => item.fullName === current.fullName);
            if (matched) return matched;
          }
          return repositories[0] || null;
        });
      } catch (error) {
        setRepoError(error instanceof Error ? error.message : 'Failed to load repositories');
        setRepoList([]);
        setRepoSelectedFullName('');
        setRepoInfo(null);
        setRepoCommits([]);
      } finally {
        setRepoListLoading(false);
      }
    },
    [githubSelectedId]
  );

  const handleOpenRepositoryCommits = useCallback(
    async (repo: GitHubRepoInfo) => {
      if (!window.electronAPI?.githubRepo) return;

      setCommitLoading(true);
      setRepoBusy(true);
      setRepoError(null);
      setRepoMessage(null);
      setRepoSelectedFullName(repo.fullName);
      setRepoInfo(repo);
      try {
        const commits = await window.electronAPI.githubRepo.listCommits({
          repo: repo.fullName,
          accountId: githubSelectedId || undefined,
          perPage: 20,
        });
        setRepoCommits(commits);
      } catch (commitError) {
        const message = commitError instanceof Error ? commitError.message : String(commitError);
        if (/empty|409/i.test(message)) {
          setRepoCommits([]);
          setRepoMessage('Repository is currently empty. No commits yet.');
        } else {
          setRepoError(message);
        }
      } finally {
        setCommitLoading(false);
        setRepoBusy(false);
      }
    },
    [githubSelectedId]
  );

  const handleCreateRepository = async () => {
    if (!window.electronAPI?.githubRepo) return;

    setRepoBusy(true);
    setRepoError(null);
    setRepoMessage(null);
    try {
      const created = await window.electronAPI.githubRepo.create({
        name: repoCreateName,
        description: repoCreateDescription,
        visibility: repoCreateVisibility,
        addReadme: repoCreateAddReadme,
        gitignoreTemplate: repoCreateGitignore || undefined,
        licenseTemplate: repoCreateLicense || undefined,
        accountId: githubSelectedId || undefined,
      });
      setRepoInfo(created);
      setRepoSelectedFullName(created.fullName);
      setRepoMessage(`Repository created: ${created.fullName}`);
      setRepoCommits([]);
      await loadMineRepositories(githubSelectedId);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : 'Failed to create repository');
    } finally {
      setRepoBusy(false);
    }
  };

  const formatCommitDate = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const snapshot: RepositoriesPageCache = {
      accountsLoaded,
      githubAccounts,
      githubSelectedId,
      repoList,
      repoSelectedFullName,
      repoInfo,
      repoCommits,
      repoMessage,
    };
    window.localStorage.setItem(REPOSITORIES_CACHE_KEY, JSON.stringify(snapshot));
  }, [
    accountsLoaded,
    githubAccounts,
    githubSelectedId,
    repoList,
    repoSelectedFullName,
    repoInfo,
    repoCommits,
    repoMessage,
  ]);

  return (
    <div className="repo-page">
      <header className="repo-header">
        <h1>Repositories</h1>
        <p>Create a GitHub repository, inspect commit history, and view SSH/HTTPS clone URLs.</p>
      </header>

      <section className="repo-card">
        <div className="repo-account-head">
          <h2>GitHub Account</h2>
          <IconButton
            className="repo-btn repo-btn-secondary"
            onClick={() => {
              loadGitHubAccounts().catch((error) => {
                setRepoError(error instanceof Error ? error.message : 'Failed to load GitHub accounts');
              });
            }}
            icon="refresh"
            label="Refresh Accounts"
            disabled={accountsLoading || repoBusy}
          />
        </div>

        {!accountsLoaded && (
          <p className="repo-hint">Click "Refresh Accounts" to load your GitHub accounts.</p>
        )}
        {accountsLoaded && githubAccounts.length === 0 && (
          <p className="repo-hint">No GitHub account found. Please connect one in Settings first.</p>
        )}
        {accountsLoaded && githubAccounts.length > 0 && (
          <label className="repo-field">
            Active Account
            <select
              value={githubSelectedId}
              onChange={(event) => {
                setGitHubSelectedId(event.target.value);
                setRepoList([]);
                setRepoSelectedFullName('');
                setRepoInfo(null);
                setRepoCommits([]);
                setRepoMessage(null);
              }}
              disabled={accountsLoading || repoBusy}
            >
              {githubAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName}
                  {account.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="repo-card">
        <div className="repo-grid">
          <div className="repo-panel">
            <h3>Create Repository</h3>
            <label className="repo-field">
              Repository Name
              <input
                value={repoCreateName}
                onChange={(event) => setRepoCreateName(event.target.value)}
                placeholder="my-new-repo"
                disabled={repoBusy}
              />
            </label>
            <label className="repo-field">
              Choose visibility
              <select
                value={repoCreateVisibility}
                onChange={(event) => setRepoCreateVisibility(event.target.value as 'public' | 'private')}
                disabled={repoBusy}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </label>
            <label className="repo-inline-check">
              <input
                type="checkbox"
                checked={repoCreateAddReadme}
                onChange={(event) => setRepoCreateAddReadme(event.target.checked)}
                disabled={repoBusy}
              />
              Add README
            </label>
            <label className="repo-field">
              Add .gitignore
              <select
                value={repoCreateGitignore}
                onChange={(event) => setRepoCreateGitignore(event.target.value)}
                disabled={repoBusy}
              >
                {GITIGNORE_OPTIONS.map((item) => (
                  <option key={item.value || 'none'} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="repo-field">
              Add license
              <select
                value={repoCreateLicense}
                onChange={(event) => setRepoCreateLicense(event.target.value)}
                disabled={repoBusy}
              >
                {LICENSE_OPTIONS.map((item) => (
                  <option key={item.value || 'none'} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="repo-field">
              Description (optional)
              <input
                value={repoCreateDescription}
                onChange={(event) => setRepoCreateDescription(event.target.value)}
                placeholder="Short project description"
                disabled={repoBusy}
              />
            </label>
            <button
              type="button"
              className="repo-btn repo-btn-primary"
              onClick={handleCreateRepository}
              disabled={repoBusy || !repoCreateName.trim()}
            >
              {repoBusy ? 'Processing...' : 'Create Repository'}
            </button>
          </div>

          <div className="repo-panel">
            <div className="repo-list-head">
              <h3>My Repositories</h3>
              <IconButton
                className="repo-btn repo-btn-secondary"
                onClick={() => {
                  loadMineRepositories().catch((error) => {
                    setRepoError(error instanceof Error ? error.message : 'Failed to load repositories');
                  });
                }}
                icon="refresh"
                label={repoListLoading ? 'Loading...' : 'Refresh Repositories'}
                disabled={repoListLoading || repoBusy || !githubSelectedId}
              />
            </div>
            <p className="repo-hint">Double-click a repository to load recent commits.</p>

            {repoListLoading && <p className="repo-hint">Loading repositories...</p>}
            {!repoListLoading && repoList.length === 0 && (
              <p className="repo-hint">No repositories found for this account.</p>
            )}

            {!repoListLoading && repoList.length > 0 && (
              <ul className="repo-list">
                {repoList.map((item) => (
                  <li
                    key={item.id}
                    className={`repo-list-item ${repoSelectedFullName === item.fullName ? 'active' : ''}`}
                    onClick={() => {
                      setRepoSelectedFullName(item.fullName);
                      setRepoInfo(item);
                      setRepoCommits([]);
                      setRepoMessage(null);
                    }}
                    onDoubleClick={() => {
                      handleOpenRepositoryCommits(item).catch((error) => {
                        setRepoError(error instanceof Error ? error.message : 'Failed to load commits');
                      });
                    }}
                  >
                    <div className="repo-list-name">{item.fullName}</div>
                    <div className="repo-list-meta">{item.private ? 'Private' : 'Public'}</div>
                    {item.description && <div className="repo-list-desc">{item.description}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {repoError && <p className="repo-error">Error: {repoError}</p>}
        {repoMessage && <p className="repo-success">{repoMessage}</p>}

        {repoInfo && (
          <div className="repo-commit-panel">
            <div className="repo-info">
              <p>
                <strong>{repoInfo.fullName}</strong>
                {repoInfo.private ? ' (private)' : ' (public)'}
              </p>
              <div className="repo-link-row">
                <span>HTTPS</span>
                <code>{repoInfo.httpsUrl}</code>
              </div>
              <div className="repo-link-row">
                <span>SSH</span>
                <code>{repoInfo.sshUrl}</code>
              </div>
            </div>
            <h3>Recent Commits</h3>
            {commitLoading ? (
              <p className="repo-hint">Loading commits...</p>
            ) : null}
            {repoCommits.length === 0 ? (
              <p className="repo-hint">
                {commitLoading ? ' ' : 'No commits loaded. Double-click repository from list to load commits.'}
              </p>
            ) : (
              <ul className="repo-commit-list">
                {repoCommits.map((commit) => (
                  <li key={commit.sha} className="repo-commit-item">
                    <div className="repo-commit-head">
                      <code>{commit.sha.slice(0, 8)}</code>
                      <a href={commit.htmlUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    </div>
                    <p>{commit.message.split('\n')[0]}</p>
                    <small>
                      {commit.authorName || 'Unknown author'} - {formatCommitDate(commit.date)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
