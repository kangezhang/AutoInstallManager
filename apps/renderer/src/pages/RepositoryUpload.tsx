import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { GitHubAccountSummary, ReleaseUploadRequest, ToolDefinition } from '@aim/shared';
import { useCatalogStore } from '../store';
import { IconButton } from '../components/ui/IconButton';
import './RepositoryInstall.css';
import './RepositoryUpload.css';

type GithubVersionSource = Extract<ToolDefinition['versionSource'], { type: 'githubReleases' }>;
type GithubTool = Omit<ToolDefinition, 'versionSource'> & { versionSource: GithubVersionSource };

interface UploadState {
  tag: string;
  releaseName: string;
  filePath: string;
  createReleaseIfMissing: boolean;
  overwriteAsset: boolean;
  draft: boolean;
  prerelease: boolean;
  uploading: boolean;
  error: string | null;
  success: string | null;
}

const isGithubTool = (tool: ToolDefinition): tool is GithubTool =>
  tool.versionSource.type === 'githubReleases';

const createDefaultUploadState = (): UploadState => ({
  tag: '',
  releaseName: '',
  filePath: '',
  createReleaseIfMissing: true,
  overwriteAsset: true,
  draft: false,
  prerelease: false,
  uploading: false,
  error: null,
  success: null,
});

export function RepositoryUpload() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tools, loading, error, loadTools } = useCatalogStore();
  const [upload, setUpload] = useState<UploadState>(() => createDefaultUploadState());
  const [repo, setRepo] = useState(searchParams.get('repo') || '');
  const [accounts, setAccounts] = useState<GitHubAccountSummary[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const repositories = useMemo(() => {
    const repoSet = new Set<string>();
    tools.filter(isGithubTool).forEach((tool) => {
      repoSet.add(tool.versionSource.repo);
    });
    return Array.from(repoSet).sort((a, b) => a.localeCompare(b));
  }, [tools]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  const loadGitHubAccounts = useCallback(async () => {
    if (!window.electronAPI?.githubAccount) return;

    setAccountLoading(true);
    try {
      const result = await window.electronAPI.githubAccount.list();
      setAccounts(result.accounts);
      setSelectedAccountId((current) => {
        const next =
          current || result.defaultAccountId || result.accounts.find((account) => account.isDefault)?.id || result.accounts[0]?.id || '';
        return result.accounts.some((account) => account.id === next) ? next : '';
      });
    } catch (loadError) {
      setUpload((prev) => ({
        ...prev,
        error: loadError instanceof Error ? loadError.message : 'Failed to load GitHub accounts',
      }));
    } finally {
      setAccountLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    loadTools().catch((loadError) => {
      console.error('Failed to load repositories for upload page:', loadError);
    });
    loadGitHubAccounts().catch((loadError) => {
      console.error('Failed to load GitHub accounts:', loadError);
    });
  }, [loadGitHubAccounts, loadTools]);

  useEffect(() => {
    const repoFromUrl = searchParams.get('repo') || '';
    setRepo(repoFromUrl);
  }, [searchParams]);

  useEffect(() => {
    if (!repo && repositories.length > 0) {
      setRepo(repositories[0]);
    }
  }, [repo, repositories]);

  const handlePickAssetFile = async () => {
    if (!window.electronAPI) return;

    try {
      const filePath = await window.electronAPI.release.pickAssetFile();
      if (!filePath) return;
      setUpload((prev) => ({ ...prev, filePath, error: null, success: null }));
    } catch (pickError) {
      setUpload((prev) => ({
        ...prev,
        error: pickError instanceof Error ? pickError.message : 'Failed to pick file',
      }));
    }
  };

  const handleUploadAsset = async () => {
    if (!window.electronAPI) return;

    if (!repo.trim()) {
      setUpload((prev) => ({ ...prev, error: 'Repository is required.' }));
      return;
    }
    if (!selectedAccountId) {
      setUpload((prev) => ({
        ...prev,
        error: 'No GitHub account selected. Please configure one in Settings.',
      }));
      return;
    }
    if (!upload.tag.trim()) {
      setUpload((prev) => ({ ...prev, error: 'Tag is required.' }));
      return;
    }
    if (!upload.filePath.trim()) {
      setUpload((prev) => ({ ...prev, error: 'Please choose local file.' }));
      return;
    }

    setUpload((prev) => ({
      ...prev,
      uploading: true,
      error: null,
      success: null,
    }));

    try {
      const payload: ReleaseUploadRequest = {
        repo: repo.trim(),
        tag: upload.tag.trim(),
        accountId: selectedAccountId,
        filePath: upload.filePath.trim(),
        releaseName: upload.releaseName.trim() || undefined,
        createReleaseIfMissing: upload.createReleaseIfMissing,
        overwriteAsset: upload.overwriteAsset,
        draft: upload.draft,
        prerelease: upload.prerelease,
      };

      const result = await window.electronAPI.release.uploadAsset(payload);
      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      setUpload((prev) => ({
        ...prev,
        uploading: false,
        success: result.assetDownloadUrl
          ? `Uploaded ${result.assetName} -> ${result.assetDownloadUrl}`
          : `Uploaded ${result.assetName || 'asset'}`,
      }));
    } catch (uploadError) {
      setUpload((prev) => ({
        ...prev,
        uploading: false,
        error: uploadError instanceof Error ? uploadError.message : 'Upload failed',
      }));
    }
  };

  return (
    <div className="repo-upload-page">
      <div className="repo-upload-page-header">
        <h1>Upload Release Asset</h1>
        <p>Use global GitHub account from Settings and avoid entering token every time.</p>
      </div>

      <div className="repo-upload-page-actions">
        <IconButton
          className="btn btn-secondary"
          onClick={() => navigate('/repositories')}
          icon="back"
          label="Back to Repositories"
        />
        <IconButton
          className="btn btn-secondary"
          onClick={() => navigate('/settings')}
          icon="settings"
          label="Manage GitHub Accounts"
        />
      </div>

      {error && <div className="repo-alert repo-alert-error">Error: {error}</div>}
      {loading && <div className="repo-empty">Loading repositories...</div>}

      <section className="repo-detail-block">
        <div className="repo-upload-grid">
          <label className="repo-upload-wide">
            GitHub Account
            <select
              value={selectedAccountId}
              onChange={(event) => {
                setSelectedAccountId(event.target.value);
                setUpload((prev) => ({ ...prev, error: null, success: null }));
              }}
              disabled={upload.uploading || accountLoading}
            >
              {accounts.length === 0 ? (
                <option value="">No account configured</option>
              ) : (
                accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName} ({account.username}@{account.host})
                    {account.isDefault ? ' [default]' : ''}
                  </option>
                ))
              )}
            </select>
          </label>

          {selectedAccount && (
            <p className="repo-help-text">
              Using account: <strong>{selectedAccount.displayName}</strong>
            </p>
          )}

          <label className="repo-upload-wide">
            Repository
            <select
              value={repo}
              onChange={(event) => {
                setRepo(event.target.value);
                setUpload((prev) => ({ ...prev, error: null, success: null }));
              }}
              disabled={upload.uploading}
            >
              {repositories.length === 0 ? (
                <option value="">No repository available</option>
              ) : (
                repositories.map((repoItem) => (
                  <option key={repoItem} value={repoItem}>
                    {repoItem}
                  </option>
                ))
              )}
            </select>
          </label>

          <label>
            Tag
            <input
              value={upload.tag}
              onChange={(event) =>
                setUpload((prev) => ({ ...prev, tag: event.target.value, error: null, success: null }))
              }
              placeholder="v1.2.3"
              disabled={upload.uploading}
            />
          </label>

          <label>
            Release Name (optional)
            <input
              value={upload.releaseName}
              onChange={(event) =>
                setUpload((prev) => ({ ...prev, releaseName: event.target.value, error: null, success: null }))
              }
              placeholder="My Release v1.2.3"
              disabled={upload.uploading}
            />
          </label>

          <label className="repo-upload-wide">
            Local File
            <div className="repo-file-picker-row">
              <input value={upload.filePath} readOnly placeholder="Choose asset file" />
              <IconButton
                className="btn btn-secondary"
                onClick={handlePickAssetFile}
                disabled={upload.uploading}
                icon="browse"
                label="Browse"
              />
            </div>
          </label>
        </div>

        <div className="repo-upload-options">
          <label className="repo-inline-checkbox">
            <input
              type="checkbox"
              checked={upload.createReleaseIfMissing}
              onChange={(event) =>
                setUpload((prev) => ({ ...prev, createReleaseIfMissing: event.target.checked }))
              }
              disabled={upload.uploading}
            />
            Create release when tag missing
          </label>
          <label className="repo-inline-checkbox">
            <input
              type="checkbox"
              checked={upload.overwriteAsset}
              onChange={(event) => setUpload((prev) => ({ ...prev, overwriteAsset: event.target.checked }))}
              disabled={upload.uploading}
            />
            Overwrite existing asset
          </label>
          <label className="repo-inline-checkbox">
            <input
              type="checkbox"
              checked={upload.draft}
              onChange={(event) => setUpload((prev) => ({ ...prev, draft: event.target.checked }))}
              disabled={upload.uploading}
            />
            Draft
          </label>
          <label className="repo-inline-checkbox">
            <input
              type="checkbox"
              checked={upload.prerelease}
              onChange={(event) => setUpload((prev) => ({ ...prev, prerelease: event.target.checked }))}
              disabled={upload.uploading}
            />
            Prerelease
          </label>
        </div>

        <div className="repo-upload-actions">
          <IconButton
            className="btn btn-primary"
            onClick={handleUploadAsset}
            disabled={upload.uploading || !repo.trim() || !selectedAccountId}
            icon="upload"
            label={upload.uploading ? 'Uploading...' : 'Upload Asset'}
          />
        </div>

        {upload.error && <p className="repo-error">Error: {upload.error}</p>}
        {upload.success && <p className="repo-success">{upload.success}</p>}
      </section>
    </div>
  );
}
