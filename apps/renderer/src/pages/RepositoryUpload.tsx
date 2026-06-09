import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  GitHubAccountSummary,
  GitHubRepoUpsertFileRequest,
  ReleaseUploadRequest,
  ReleaseUploadResult,
} from '@devstack/shared';
import { useCatalogStore } from '../store';
import { useI18n } from '../i18n';
import { IconButton } from '../components/ui/IconButton';
import './Repositories.css';

// ── Types ────────────────────────────────────────────────────────────────────

type AssetPlatform = 'win' | 'mac' | 'linux';
type AssetArch = 'x64' | 'arm64' | 'ia32';
type AssetType = 'msi' | 'exe' | 'pkg' | 'zip' | 'tar.gz' | 'dmg';
type InstallType = 'msi' | 'exe' | 'pkg' | 'archive';
type PageStatus = 'idle' | 'uploading' | 'publishing';

interface FormState {
  // Step 1 — target
  accountId: string;
  repo: string;
  tag: string;
  filePath: string;
  // Step 2 — catalog definition (auto-filled after upload)
  toolId: string;
  name: string;
  description: string;
  homepage: string;
  tags: string;
  platform: AssetPlatform;
  arch: AssetArch;
  assetType: AssetType;
  assetUrl: string;
  installType: InstallType;
  validateCommand: string;
  // Step 3 — publish
  publishPath: string;
  commitMessage: string;
  // Advanced (hidden)
  tagPrefix: string;
  releaseName: string;
  silentArgs: string;
  targetDir: string;
  requiresAdmin: boolean;
  publishBranch: string;
  overwriteAsset: boolean;
  createReleaseIfMissing: boolean;
  draft: boolean;
  prerelease: boolean;
  overwriteRemote: boolean;
  saveLocal: boolean;
  overwriteLocal: boolean;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const normalizeRepo = (v: string) => {
  const raw = v.trim().replace(/\.git$/i, '');
  if (!raw) return '';
  const m = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (m) return `${m[1]}/${m[2]}`;
  const s = raw.match(/^([^/]+)\/([^/]+)$/);
  return s ? `${s[1]}/${s[2]}` : '';
};

const slugify = (v: string) =>
  v.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const splitCsv = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

const quoteYaml = (v: string) => `'${v.replace(/'/g, "''")}'`;

const inferAssetType = (name: string): AssetType => {
  const n = name.toLowerCase();
  if (n.endsWith('.tar.gz')) return 'tar.gz';
  if (n.endsWith('.msi')) return 'msi';
  if (n.endsWith('.exe')) return 'exe';
  if (n.endsWith('.pkg')) return 'pkg';
  if (n.endsWith('.dmg')) return 'dmg';
  return 'zip';
};

const inferPlatform = (name: string): AssetPlatform => {
  const n = name.toLowerCase();
  if (n.includes('darwin') || n.includes('mac') || n.includes('osx')) return 'mac';
  if (n.includes('linux') || n.includes('ubuntu') || n.includes('debian')) return 'linux';
  return 'win';
};

const inferArch = (name: string): AssetArch => {
  const n = name.toLowerCase();
  if (n.includes('arm64') || n.includes('aarch64')) return 'arm64';
  if (n.includes('ia32') || n.includes('x86') || n.includes('i386') || n.includes('386'))
    return 'ia32';
  return 'x64';
};

const inferInstallType = (t: AssetType): InstallType =>
  t === 'msi' ? 'msi' : t === 'pkg' ? 'pkg' : t === 'exe' ? 'exe' : 'archive';

const inferToolId = (assetName: string, fallback: string): string => {
  const stripped = assetName
    .replace(/\.(tar\.gz|zip|exe|msi|pkg|dmg)$/i, '')
    .replace(/[-_.]v?\d+(?:\.\d+){1,3}(?:[-_.][0-9A-Za-z]+)*/g, '')
    .replace(/[-_.](windows|win|linux|darwin|mac|osx|amd64|x86_64|x64|arm64|aarch64|ia32|x86)/gi, '')
    .replace(/[-_.]+$/g, '');
  return slugify(stripped || fallback) || 'tool';
};

const inferTagPrefix = (tag: string): string => {
  const m = tag.trim().match(/(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  if (!m) return '';
  return tag.trim().slice(0, tag.trim().length - m[1].length);
};

const toTagTemplateUrl = (url: string, tag: string): string => {
  const t = tag.trim();
  if (!t) return url;
  return url.split(encodeURIComponent(t)).join('{tag}').split(t).join('{tag}');
};

const defaultPublishPath = (toolId: string) => `catalog/${slugify(toolId) || 'tool'}.yaml`;

// ── YAML builder ─────────────────────────────────────────────────────────────

const buildYaml = (f: FormState): string => {
  const repo = normalizeRepo(f.repo);
  const toolId = slugify(f.toolId);
  if (!repo) throw new Error('Repository must be owner/repo or GitHub URL');
  if (!toolId) throw new Error('Tool ID cannot be empty');
  if (!f.assetUrl.trim()) throw new Error('Asset URL template cannot be empty');

  const lines: string[] = [];
  lines.push('schemaVersion: "1.0.0"');
  lines.push(`id: ${toolId}`);
  lines.push(`name: ${quoteYaml(f.name.trim() || toolId)}`);
  if (f.description.trim()) lines.push(`description: ${quoteYaml(f.description.trim())}`);
  lines.push(`homepage: ${quoteYaml(f.homepage.trim() || `https://github.com/${repo}`)}`);

  const tags = splitCsv(f.tags);
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) lines.push(`  - ${quoteYaml(tag)}`);
  }

  lines.push('', 'versionSource:', '  type: githubReleases', `  repo: ${quoteYaml(repo)}`);
  if (f.tagPrefix.trim()) lines.push(`  tagPrefix: ${quoteYaml(f.tagPrefix.trim())}`);

  lines.push('', 'assets:');
  lines.push(`  - platform: ${f.platform}`);
  lines.push(`    arch: ${f.arch}`);
  lines.push(`    url: ${quoteYaml(f.assetUrl.trim())}`);
  lines.push(`    type: ${f.assetType}`);

  lines.push('', 'install:');
  lines.push(`  type: ${f.installType}`);
  lines.push(`  requiresAdmin: ${f.requiresAdmin}`);
  if (f.silentArgs.trim()) lines.push(`  silentArgs: ${quoteYaml(f.silentArgs.trim())}`);
  if (f.targetDir.trim()) lines.push(`  targetDir: ${quoteYaml(f.targetDir.trim())}`);

  lines.push('', 'validate:');
  lines.push(`  command: ${quoteYaml(f.validateCommand.trim() || `${toolId} --version`)}`);
  lines.push('  parse: semver');

  return `${lines.join('\n')}\n`;
};

// ── Default form ──────────────────────────────────────────────────────────────

const createDefaultForm = (repoParam = ''): FormState => {
  const repo = normalizeRepo(repoParam);
  const repoName = repo ? repo.split('/')[1] || 'tool' : 'tool';
  const toolId = slugify(repoName) || 'tool';
  return {
    accountId: '',
    repo: repo || repoParam,
    tag: '',
    filePath: '',
    toolId,
    name: repoName,
    description: '',
    homepage: repo ? `https://github.com/${repo}` : '',
    tags: 'custom,github',
    platform: 'win',
    arch: 'x64',
    assetType: 'exe',
    assetUrl: repo ? `https://github.com/${repo}/releases/download/{tag}/${toolId}.exe` : '',
    installType: 'exe',
    validateCommand: `${toolId} --version`,
    publishPath: defaultPublishPath(toolId),
    commitMessage: `Add ${toolId} catalog definition`,
    tagPrefix: '',
    releaseName: '',
    silentArgs: '/S',
    targetDir: '',
    requiresAdmin: false,
    publishBranch: '',
    overwriteAsset: true,
    createReleaseIfMissing: true,
    draft: false,
    prerelease: false,
    overwriteRemote: true,
    saveLocal: true,
    overwriteLocal: true,
  };
};

// ── Component ─────────────────────────────────────────────────────────────────

export function RepositoryUpload() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loadTools } = useCatalogStore();
  const { t } = useI18n();

  const [form, setFormState] = useState<FormState>(() =>
    createDefaultForm(searchParams.get('repo') || '')
  );
  const [status, setStatus] = useState<PageStatus>('idle');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [accounts, setAccounts] = useState<GitHubAccountSummary[]>([]);
  const [repoList, setRepoList] = useState<string[]>([]);
  const [repoListLoading, setRepoListLoading] = useState(false);
  const [customRepo, setCustomRepo] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const busy = status !== 'idle';

  const set = (patch: Partial<FormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }));
    setMsg(null);
  };

  const loadRepos = async (accountId: string) => {
    if (!window.electronAPI?.githubRepo || !accountId) {
      setRepoList([]);
      return;
    }
    setRepoListLoading(true);
    try {
      const repos = await window.electronAPI.githubRepo.listMine({ accountId, perPage: 100, maxPages: 3 });
      const names = repos.map((r) => r.fullName).sort();
      setRepoList(names);
      // Auto-select first if current repo not in list and no custom input
      setFormState((prev) => {
        if (prev.repo && names.includes(normalizeRepo(prev.repo))) return prev;
        if (prev.repo) return prev; // keep custom value
        const first = names[0] || '';
        return first ? { ...prev, ...patchFromRepo(first) } : prev;
      });
    } catch {
      setRepoList([]);
    } finally {
      setRepoListLoading(false);
    }
  };

  // Derive default definition fields from a newly selected repo name
  const patchFromRepo = (repoFullName: string): Partial<FormState> => {
    const repo = normalizeRepo(repoFullName);
    if (!repo) return {};
    const repoName = repo.split('/')[1] || 'tool';
    const toolId = slugify(repoName) || 'tool';
    return {
      repo: repoFullName,
      toolId,
      name: repoName,
      homepage: `https://github.com/${repo}`,
      assetUrl: `https://github.com/${repo}/releases/download/{tag}/${toolId}.exe`,
      validateCommand: `${toolId} --version`,
      publishPath: defaultPublishPath(toolId),
      commitMessage: `Add ${toolId} catalog definition`,
    };
  };

  // YAML preview
  const yamlPreview = useMemo(() => {
    try {
      return buildYaml(form);
    } catch (e) {
      return e instanceof Error ? `# ${e.message}` : '# Error';
    }
  }, [form]);

  // Load accounts + catalog on mount
  useEffect(() => {
    if (!window.electronAPI) return;
    loadTools().catch(console.error);
    window.electronAPI.githubAccount
      .list()
      .then((result) => {
        setAccounts(result.accounts);
        const defaultId =
          result.defaultAccountId ||
          result.accounts.find((a) => a.isDefault)?.id ||
          result.accounts[0]?.id ||
          '';
        setFormState((prev) => ({
          ...prev,
          accountId: prev.accountId || defaultId,
        }));
        if (defaultId) loadRepos(defaultId).catch(console.error);
      })
      .catch(console.error);
  }, [loadTools]);

  // Sync repo from URL params
  useEffect(() => {
    const repoParam = searchParams.get('repo');
    if (!repoParam) return;
    const repo = normalizeRepo(repoParam);
    const repoName = repo ? repo.split('/')[1] || 'tool' : 'tool';
    const toolId = slugify(repoName) || 'tool';
    setFormState((prev) => ({
      ...prev,
      repo: repo || repoParam,
      toolId: prev.toolId || toolId,
      name: prev.name || repoName,
      homepage: prev.homepage || (repo ? `https://github.com/${repo}` : ''),
      publishPath: prev.publishPath || defaultPublishPath(toolId),
    }));
  }, [searchParams]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePickFile = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.release.pickAssetFile();
    if (path) set({ filePath: path });
  };

  const handleUpload = async () => {
    if (!window.electronAPI) return;
    const repo = normalizeRepo(form.repo);
    if (!repo) return setMsg({ type: 'error', text: 'Repository must be owner/repo or GitHub URL.' });
    if (!form.accountId) return setMsg({ type: 'error', text: 'Select a GitHub account.' });
    if (!form.tag.trim()) return setMsg({ type: 'error', text: 'Tag is required.' });
    if (!form.filePath.trim()) return setMsg({ type: 'error', text: 'Choose a local file.' });

    setStatus('uploading');
    setMsg(null);
    setUploadedUrl(null);
    setUploadPercent(0);

    const unsubProgress = window.electronAPI?.events?.onUploadProgress?.((p) => {
      setUploadPercent(p.percent);
    });

    try {
      const payload: ReleaseUploadRequest = {
        repo,
        tag: form.tag.trim(),
        accountId: form.accountId,
        filePath: form.filePath.trim(),
        releaseName: form.releaseName.trim() || undefined,
        createReleaseIfMissing: form.createReleaseIfMissing,
        overwriteAsset: form.overwriteAsset,
        draft: form.draft,
        prerelease: form.prerelease,
        targetBranch: form.publishBranch.trim() || undefined,
      };

      const result: ReleaseUploadResult = await window.electronAPI.release.uploadAsset(payload);
      if (!result.success) throw new Error(result.error || 'Upload failed');

      // Auto-fill definition from upload result
      const assetName =
        result.assetName || form.filePath.split(/[\\/]/).pop() || 'asset';
      const repoName = repo.split('/')[1] || 'tool';
      const toolId = inferToolId(assetName, repoName);
      const assetType = inferAssetType(assetName);
      const assetUrl = result.assetDownloadUrl
        ? toTagTemplateUrl(result.assetDownloadUrl, form.tag.trim())
        : form.assetUrl;

      setFormState((prev) => ({
        ...prev,
        toolId: prev.toolId !== slugify(prev.name) ? prev.toolId : toolId,
        name: prev.name || toolId,
        homepage: prev.homepage || `https://github.com/${repo}`,
        tagPrefix: prev.tagPrefix || inferTagPrefix(form.tag.trim()),
        platform: inferPlatform(assetName),
        arch: inferArch(assetName),
        assetType,
        assetUrl,
        installType: inferInstallType(assetType),
        validateCommand:
          prev.validateCommand === `${prev.toolId} --version` || !prev.validateCommand
            ? `${toolId} --version`
            : prev.validateCommand,
        publishPath:
          prev.publishPath === defaultPublishPath(prev.toolId) || !prev.publishPath
            ? defaultPublishPath(toolId)
            : prev.publishPath,
        commitMessage:
          prev.commitMessage === `Add ${prev.toolId} catalog definition` || !prev.commitMessage
            ? `Add ${toolId} catalog definition`
            : prev.commitMessage,
      }));

      if (result.releaseUrl) setUploadedUrl(result.releaseUrl);
      setMsg({
        type: 'success',
        text: `Uploaded ${result.assetName || 'asset'} — definition fields auto-filled.`,
      });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Upload failed' });
    } finally {
      unsubProgress?.();
      setUploadPercent(0);
      setStatus('idle');
    }
  };

  const handlePublish = async () => {
    if (!window.electronAPI?.githubRepo) return;
    const repo = normalizeRepo(form.repo);
    if (!repo) return setMsg({ type: 'error', text: 'Repository must be owner/repo or GitHub URL.' });
    if (!form.accountId) return setMsg({ type: 'error', text: 'Select a GitHub account.' });

    let yaml = '';
    try {
      yaml = buildYaml(form);
    } catch (e) {
      return setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Invalid definition' });
    }

    setStatus('publishing');
    setMsg(null);

    try {
      const payload: GitHubRepoUpsertFileRequest = {
        repo,
        accountId: form.accountId,
        path: form.publishPath.trim() || defaultPublishPath(form.toolId),
        content: yaml,
        commitMessage:
          form.commitMessage.trim() ||
          `Add ${slugify(form.toolId) || 'tool'} catalog definition`,
        branch: form.publishBranch.trim() || undefined,
        overwrite: form.overwriteRemote,
      };

      const result = await window.electronAPI.githubRepo.upsertFile(payload);
      if (!result.success) throw new Error(result.error || 'Publish failed');

      let extra = '';
      if (form.saveLocal && window.electronAPI.catalog) {
        const created = await window.electronAPI.catalog.addToolDefinition(yaml, {
          overwrite: form.overwriteLocal,
        });
        extra = ` Local catalog updated: ${created.id}.`;
        await loadTools();
      }

      setMsg({
        type: 'success',
        text: `Published ${result.path || payload.path} to ${repo}.${extra}`,
      });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Publish failed' });
    } finally {
      setStatus('idle');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="repo-page">
      <header className="repo-header">
        <h1>{t('publish.title')}</h1>
        <p>{t('publish.subtitle')}</p>
      </header>

      <div className="repo-actions">
        <IconButton
          className="repo-btn repo-btn-secondary"
          onClick={() => navigate('/repositories')}
          icon="back"
          label={t('publish.backToRepos')}
        />
        <IconButton
          className="repo-btn repo-btn-secondary"
          onClick={() => navigate('/settings')}
          icon="settings"
          label={t('publish.manageAccounts')}
        />
      </div>

      {/* ── Step 1: Target ── */}
      <section className="repo-card">
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#1f2937' }}>
          {t('publish.step1')}
        </h2>

        <div className="repo-two-col">
          <label className="repo-field repo-col-span">
            {t('publish.githubAccount')}
            <select
              value={form.accountId}
              onChange={(e) => {
                const accountId = e.target.value;
                set({ accountId });
                setCustomRepo(false);
                loadRepos(accountId).catch(console.error);
              }}
              disabled={busy}
            >
              {accounts.length === 0 ? (
                <option value="">{t('publish.noAccount')}</option>
              ) : (
                accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName} ({a.username}@{a.host})
                    {a.isDefault ? ` ${t('publish.accountDefault')}` : ''}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="repo-field repo-col-span">
            {t('publish.repository')}
            {customRepo ? (
              <div className="repo-file-picker-row">
                <input
                  value={form.repo}
                  onChange={(e) => set({ repo: e.target.value })}
                  placeholder="owner/repo or https://github.com/owner/repo"
                  disabled={busy}
                  autoFocus
                />
                <button
                  type="button"
                  className="repo-btn repo-btn-secondary"
                  onClick={() => setCustomRepo(false)}
                  disabled={busy}
                  title={t('publish.repoBackToList')}
                >
                  ↩
                </button>
              </div>
            ) : (
              <select
                value={form.repo}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setCustomRepo(true);
                    set({ repo: '' });
                  } else {
                    set(patchFromRepo(e.target.value));
                  }
                }}
                disabled={busy || repoListLoading}
              >
                {repoListLoading ? (
                  <option value="">{t('publish.repoLoading')}</option>
                ) : repoList.length === 0 ? (
                  <option value="">{t('publish.repoEmpty')}</option>
                ) : (
                  repoList.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))
                )}
                <option value="__custom__">{t('publish.repoManual')}</option>
              </select>
            )}
          </label>

          <label className="repo-field">
            {t('publish.tag')}
            <input
              value={form.tag}
              onChange={(e) => set({ tag: e.target.value })}
              placeholder={t('publish.tagPlaceholder')}
              disabled={busy}
            />
          </label>

          <label className="repo-field">
            {t('publish.localFile')}
            <div className="repo-file-picker-row">
              <input value={form.filePath} readOnly placeholder={t('publish.chooseFile')} />
              <IconButton
                className="repo-btn repo-btn-secondary"
                onClick={handlePickFile}
                disabled={busy}
                icon="browse"
                label={t('publish.browse')}
              />
            </div>
          </label>
        </div>

        <details className="repo-advanced">
          <summary>{t('publish.uploadOptions')}</summary>
          <div className="repo-advanced-body">
            <label className="repo-field">
              {t('publish.releaseName')}
              <input
                value={form.releaseName}
                onChange={(e) => set({ releaseName: e.target.value })}
                placeholder={t('publish.releaseNamePlaceholder')}
                disabled={busy}
              />
            </label>
            <div className="repo-checks">
              {(
                [
                  ['createReleaseIfMissing', 'publish.createReleaseIfMissing'],
                  ['overwriteAsset', 'publish.overwriteAsset'],
                  ['draft', 'publish.draft'],
                  ['prerelease', 'publish.prerelease'],
                ] as [keyof FormState, Parameters<typeof t>[0]][]
              ).map(([key, labelKey]) => (
                <label key={key} className="repo-inline-check">
                  <input
                    type="checkbox"
                    checked={form[key] as boolean}
                    onChange={(e) => set({ [key]: e.target.checked })}
                    disabled={busy}
                  />
                  {t(labelKey)}
                </label>
              ))}
            </div>
          </div>
        </details>

        <div className="repo-actions">
          <button
            type="button"
            className="repo-btn repo-btn-primary"
            onClick={handleUpload}
            disabled={busy || !normalizeRepo(form.repo) || !form.accountId}
          >
            {status === 'uploading' ? t('publish.uploading') : t('publish.uploadBtn')}
          </button>
          {uploadedUrl && (
            <a
              href={uploadedUrl}
              className="repo-hint"
              target="_blank"
              rel="noreferrer"
              style={{ alignSelf: 'center' }}
            >
              {t('publish.viewRelease')}
            </a>
          )}
        </div>
        {status === 'uploading' && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>
              <span>{t('publish.uploading')}</span>
              <span>{uploadPercent}%</span>
            </div>
            <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${uploadPercent}%`,
                  background: '#3b82f6',
                  borderRadius: '3px',
                  transition: 'width 0.15s ease',
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Step 2: Catalog Definition ── */}
      <section className="repo-card">
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#1f2937' }}>
          {t('publish.step2')}
          <span className="repo-hint" style={{ fontWeight: 'normal', marginLeft: '0.5rem' }}>
            {t('publish.autoFilled')}
          </span>
        </h2>

        <div className="repo-two-col">
          <label className="repo-field">
            {t('publish.toolId')}
            <input
              value={form.toolId}
              onChange={(e) => set({ toolId: slugify(e.target.value) })}
              placeholder="my-tool"
              disabled={busy}
            />
          </label>

          <label className="repo-field">
            {t('publish.name')}
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="My Tool"
              disabled={busy}
            />
          </label>

          <label className="repo-field repo-col-span">
            {t('publish.assetUrl')}
            <input
              value={form.assetUrl}
              onChange={(e) => set({ assetUrl: e.target.value })}
              placeholder="https://github.com/owner/repo/releases/download/{tag}/tool.exe"
              disabled={busy}
            />
          </label>

          <label className="repo-field">
            {t('publish.platform')}
            <select
              value={form.platform}
              onChange={(e) => set({ platform: e.target.value as AssetPlatform })}
              disabled={busy}
            >
              <option value="win">win</option>
              <option value="mac">mac</option>
              <option value="linux">linux</option>
            </select>
          </label>

          <label className="repo-field">
            {t('publish.arch')}
            <select
              value={form.arch}
              onChange={(e) => set({ arch: e.target.value as AssetArch })}
              disabled={busy}
            >
              <option value="x64">x64</option>
              <option value="arm64">arm64</option>
              <option value="ia32">ia32</option>
            </select>
          </label>

          <label className="repo-field">
            {t('publish.assetType')}
            <select
              value={form.assetType}
              onChange={(e) => {
                const tp = e.target.value as AssetType;
                set({ assetType: tp, installType: inferInstallType(tp) });
              }}
              disabled={busy}
            >
              <option value="exe">exe</option>
              <option value="msi">msi</option>
              <option value="pkg">pkg</option>
              <option value="zip">zip</option>
              <option value="tar.gz">tar.gz</option>
              <option value="dmg">dmg</option>
            </select>
          </label>

          <label className="repo-field">
            {t('publish.installType')}
            <select
              value={form.installType}
              onChange={(e) => set({ installType: e.target.value as InstallType })}
              disabled={busy}
            >
              <option value="archive">archive</option>
              <option value="exe">exe</option>
              <option value="msi">msi</option>
              <option value="pkg">pkg</option>
            </select>
          </label>

          <label className="repo-field repo-col-span">
            {t('publish.validateCommand')}
            <input
              value={form.validateCommand}
              onChange={(e) => set({ validateCommand: e.target.value })}
              placeholder="my-tool --version"
              disabled={busy}
            />
          </label>
        </div>

        <details className="repo-advanced">
          <summary>{t('publish.moreOptions')}</summary>
          <div className="repo-advanced-body">
            <div className="repo-two-col">
              <label className="repo-field">
                {t('publish.description')}
                <input
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  placeholder={t('publish.descriptionPlaceholder')}
                  disabled={busy}
                />
              </label>
              <label className="repo-field">
                {t('publish.homepage')}
                <input
                  value={form.homepage}
                  onChange={(e) => set({ homepage: e.target.value })}
                  placeholder="https://github.com/owner/repo"
                  disabled={busy}
                />
              </label>
              <label className="repo-field">
                {t('publish.tags')}
                <input
                  value={form.tags}
                  onChange={(e) => set({ tags: e.target.value })}
                  placeholder="custom,github"
                  disabled={busy}
                />
              </label>
              <label className="repo-field">
                {t('publish.tagPrefix')}
                <input
                  value={form.tagPrefix}
                  onChange={(e) => set({ tagPrefix: e.target.value })}
                  placeholder="tool-v"
                  disabled={busy}
                />
              </label>
              <label className="repo-field">
                {t('publish.silentArgs')}
                <input
                  value={form.silentArgs}
                  onChange={(e) => set({ silentArgs: e.target.value })}
                  placeholder="/S"
                  disabled={busy}
                />
              </label>
              <label className="repo-field">
                {t('publish.targetDir')}
                <input
                  value={form.targetDir}
                  onChange={(e) => set({ targetDir: e.target.value })}
                  placeholder="{managed}/my-tool/{version}"
                  disabled={busy}
                />
              </label>
            </div>
            <label className="repo-inline-check">
              <input
                type="checkbox"
                checked={form.requiresAdmin}
                onChange={(e) => set({ requiresAdmin: e.target.checked })}
                disabled={busy}
              />
              {t('publish.requiresAdmin')}
            </label>
          </div>
        </details>

        <label className="repo-field" style={{ marginTop: '0.75rem' }}>
          {t('publish.generatedYaml')}
          <textarea
            value={yamlPreview}
            readOnly
            rows={16}
            style={{
              fontFamily: "Consolas, 'Courier New', monospace",
              fontSize: '0.82rem',
              lineHeight: 1.4,
              resize: 'vertical',
              border: '1px solid #d4dde8',
              borderRadius: '8px',
              padding: '0.65rem',
            }}
          />
        </label>
      </section>

      {/* ── Step 3: Publish ── */}
      <section className="repo-card">
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#1f2937' }}>
          {t('publish.step3')}
        </h2>

        <div className="repo-two-col">
          <label className="repo-field repo-col-span">
            {t('publish.publishPath')}
            <input
              value={form.publishPath}
              onChange={(e) => set({ publishPath: e.target.value })}
              placeholder="catalog/my-tool.yaml"
              disabled={busy}
            />
          </label>
          <label className="repo-field repo-col-span">
            {t('publish.commitMessage')}
            <input
              value={form.commitMessage}
              onChange={(e) => set({ commitMessage: e.target.value })}
              placeholder="Add my-tool catalog definition"
              disabled={busy}
            />
          </label>
        </div>

        <details className="repo-advanced">
          <summary>{t('publish.publishOptions')}</summary>
          <div className="repo-advanced-body">
            <label className="repo-field">
              {t('publish.branch')}
              <input
                value={form.publishBranch}
                onChange={(e) => set({ publishBranch: e.target.value })}
                placeholder="main"
                disabled={busy}
              />
            </label>
            <div className="repo-checks">
              {(
                [
                  ['overwriteRemote', 'publish.overwriteRemote'],
                  ['saveLocal', 'publish.saveLocal'],
                  ['overwriteLocal', 'publish.overwriteLocal'],
                ] as [keyof FormState, Parameters<typeof t>[0]][]
              ).map(([key, labelKey]) => (
                <label key={key} className="repo-inline-check">
                  <input
                    type="checkbox"
                    checked={form[key] as boolean}
                    onChange={(e) => set({ [key]: e.target.checked })}
                    disabled={busy || (key === 'overwriteLocal' && !form.saveLocal)}
                  />
                  {t(labelKey)}
                </label>
              ))}
            </div>
          </div>
        </details>

        <div className="repo-actions">
          <button
            type="button"
            className="repo-btn repo-btn-primary"
            onClick={handlePublish}
            disabled={busy || !normalizeRepo(form.repo) || !form.accountId}
          >
            {status === 'publishing' ? 'Publishing…' : 'Publish Tool Definition'}
          </button>
        </div>

        {msg && (
          <p className={msg.type === 'error' ? 'repo-error' : 'repo-success'}>{msg.text}</p>
        )}
      </section>
    </div>
  );
}
