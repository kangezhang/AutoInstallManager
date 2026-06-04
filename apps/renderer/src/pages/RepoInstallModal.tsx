import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReleaseDiscoverResult, ToolDefinition } from '@aim/shared';
import { useCatalogStore, useInstallerStore } from '../store';
import { IconButton } from '../components/ui/IconButton';
import { useI18n } from '../i18n';

type GithubVersionSource = Extract<ToolDefinition['versionSource'], { type: 'githubReleases' }>;
type GithubTool = Omit<ToolDefinition, 'versionSource'> & { versionSource: GithubVersionSource };
type RepoInstallType = 'archive' | 'msi' | 'exe' | 'pkg';
type RepoAssetType = 'msi' | 'exe' | 'pkg' | 'zip' | 'tar.gz' | 'dmg';
type ToolStatusTone = 'ok' | 'warn' | 'neutral';
type ToolInstallState = 'installed' | 'in-progress' | 'not-installed';

interface RepoAssetRow {
  platform: 'win' | 'mac' | 'linux';
  arch: 'x64' | 'arm64' | 'ia32';
  type: RepoAssetType;
  url: string;
}

interface AddRepoForm {
  repo: string;
  id: string;
  name: string;
  description: string;
  homepage: string;
  tags: string;
  installType: RepoInstallType;
  requiresAdmin: boolean;
  silentArgs: string;
  validateCommand: string;
  assets: RepoAssetRow[];
}

interface ToolSelectState {
  selected: boolean;
  version: string;
}

export interface RepoInstallModalProps {
  repoFullName: string;
  accountId: string;
  onClose: () => void;
}

const IN_PROGRESS = new Set(['pending', 'downloading', 'installing', 'rolling-back', 'uninstalling']);

const isGithubTool = (tool: ToolDefinition): tool is GithubTool =>
  tool.versionSource.type === 'githubReleases';

const splitCsv = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const quoteYaml = (value: string) => `'${value.replace(/'/g, "''")}'`;

const normalizeRepo = (value: string) => {
  const raw = value.trim().replace(/\.git$/i, '');
  if (!raw) return '';
  const urlMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (urlMatch) return `${urlMatch[1]}/${urlMatch[2]}`;
  const shortMatch = raw.match(/^([^/]+)\/([^/]+)$/);
  return shortMatch ? `${shortMatch[1]}/${shortMatch[2]}` : '';
};

const ensureToolId = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

const createDefaultAddFormForRepo = (repoValue: string, existingTools: GithubTool[] = []): AddRepoForm => {
  const repo = normalizeRepo(repoValue);
  const repoName = repo ? repo.split('/')[1] || 'tool' : 'tool';
  const existingIds = new Set(existingTools.map((tool) => tool.id));
  const baseId = ensureToolId(`${repoName}-tool`) || 'tool';
  let nextId = baseId;
  let suffix = 2;
  while (existingIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return {
    repo,
    id: nextId,
    name: `${repoName}-${existingTools.length + 1}`,
    description: '',
    homepage: `https://github.com/${repo}`,
    tags: 'custom,github',
    installType: 'exe',
    requiresAdmin: false,
    silentArgs: '/S',
    validateCommand: `${nextId} --version`,
    assets: [
      {
        platform: 'win',
        arch: 'x64',
        type: 'exe',
        url: `https://github.com/${repo}/releases/download/{version}/${nextId}.exe`,
      },
    ],
  };
};

const buildToolYaml = (form: AddRepoForm): string => {
  const repo = normalizeRepo(form.repo);
  const toolId = ensureToolId(form.id);

  if (!repo) throw new Error('Repository must be owner/repo or GitHub URL');
  if (!toolId) throw new Error('Tool ID cannot be empty');

  const assets = form.assets.filter((asset) => asset.url.trim().length > 0);
  if (assets.length === 0) throw new Error('At least one asset URL is required');

  const lines: string[] = [];
  lines.push('schemaVersion: "1.0.0"');
  lines.push(`id: ${toolId}`);
  lines.push(`name: ${quoteYaml(form.name.trim() || toolId)}`);
  if (form.description.trim()) lines.push(`description: ${quoteYaml(form.description.trim())}`);
  lines.push(`homepage: ${quoteYaml(form.homepage.trim() || `https://github.com/${repo}`)}`);

  const tags = splitCsv(form.tags);
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) {
      lines.push(`  - ${quoteYaml(tag)}`);
    }
  }

  lines.push('');
  lines.push('versionSource:');
  lines.push('  type: githubReleases');
  lines.push(`  repo: ${quoteYaml(repo)}`);

  lines.push('');
  lines.push('assets:');
  for (const asset of assets) {
    lines.push(`  - platform: ${asset.platform}`);
    lines.push(`    arch: ${asset.arch}`);
    lines.push(`    url: ${quoteYaml(asset.url.trim())}`);
    lines.push(`    type: ${asset.type}`);
  }

  lines.push('');
  lines.push('install:');
  lines.push(`  type: ${form.installType}`);
  lines.push(`  requiresAdmin: ${form.requiresAdmin ? 'true' : 'false'}`);
  if (form.silentArgs.trim()) {
    lines.push(`  silentArgs: ${quoteYaml(form.silentArgs.trim())}`);
  }

  lines.push('');
  lines.push('validate:');
  lines.push(`  command: ${quoteYaml(form.validateCommand.trim() || `${toolId} --version`)}`);
  lines.push('  parse: semver');

  return `${lines.join('\n')}\n`;
};

const getToolStatusTone = (status: string): ToolStatusTone => {
  if (status === 'installed') return 'ok';
  if (status === 'failed') return 'warn';
  return 'neutral';
};

const getToolInstallState = (status?: string): ToolInstallState => {
  if (!status) return 'not-installed';
  if (IN_PROGRESS.has(status)) return 'in-progress';
  if (status === 'installed') return 'installed';
  return 'not-installed';
};

const inferAssetType = (assetName: string): RepoAssetType => {
  const lower = assetName.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tar.gz';
  if (lower.endsWith('.msi')) return 'msi';
  if (lower.endsWith('.exe')) return 'exe';
  if (lower.endsWith('.pkg')) return 'pkg';
  if (lower.endsWith('.dmg')) return 'dmg';
  if (lower.endsWith('.zip')) return 'zip';
  return 'exe';
};

const inferAssetPlatform = (assetName: string): RepoAssetRow['platform'] => {
  const lower = assetName.toLowerCase();
  if (lower.includes('darwin') || lower.includes('mac') || lower.includes('osx')) return 'mac';
  if (lower.includes('linux') || lower.includes('ubuntu') || lower.includes('debian')) return 'linux';
  return 'win';
};

const inferAssetArch = (assetName: string): RepoAssetRow['arch'] => {
  const lower = assetName.toLowerCase();
  if (lower.includes('arm64') || lower.includes('aarch64')) return 'arm64';
  if (lower.includes('ia32') || lower.includes('x86') || lower.includes('i386') || lower.includes('386')) {
    return 'ia32';
  }
  return 'x64';
};

const toVersionTemplateUrl = (downloadUrl: string, tag: string): string => {
  const encodedTag = encodeURIComponent(tag);
  const withEncodedTag = downloadUrl.replace(`/download/${encodedTag}/`, '/download/{version}/');
  return withEncodedTag.replace(`/download/${tag}/`, '/download/{version}/');
};

const inferToolIdFromAsset = (assetName: string, fallbackName: string): string => {
  const stripped = assetName
    .replace(/\.(tar\.gz|zip|exe|msi|pkg|dmg)$/i, '')
    .replace(/[-_.]v?\d+(?:\.\d+){1,3}(?:[-_.][0-9A-Za-z]+)*/g, '')
    .replace(/[-_.](windows|win|linux|darwin|mac|osx|amd64|x86_64|x64|arm64|aarch64|ia32|x86)/gi, '')
    .replace(/[-_.]+$/g, '');
  return ensureToolId(stripped || fallbackName) || 'tool';
};

export function RepoInstallModal({ repoFullName, accountId, onClose }: RepoInstallModalProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { tools, loadTools } = useCatalogStore();
  const { tasks, loadTasks, createTask } = useInstallerStore();

  const [detailSelection, setDetailSelection] = useState<Record<string, ToolSelectState>>({});
  const [detailVersions, setDetailVersions] = useState<Record<string, string[]>>({});
  const [detailVersionLoading, setDetailVersionLoading] = useState<Record<string, boolean>>({});
  const [detailVersionError, setDetailVersionError] = useState<Record<string, string | null>>({});
  const [detailInstallLoading, setDetailInstallLoading] = useState(false);
  const [detailInstallError, setDetailInstallError] = useState<string | null>(null);
  const [detailInstallLogs, setDetailInstallLogs] = useState<string[]>([]);
  const [detailToolActionLoading, setDetailToolActionLoading] = useState<Record<string, boolean>>({});
  const [detailAddForm, setDetailAddForm] = useState<AddRepoForm | null>(null);
  const [detailAddOverwrite, setDetailAddOverwrite] = useState(false);
  const [detailAddLoading, setDetailAddLoading] = useState(false);
  const [detailAddError, setDetailAddError] = useState<string | null>(null);
  const [detailAddSuccess, setDetailAddSuccess] = useState<string | null>(null);
  const [detailDiscoverLoading, setDetailDiscoverLoading] = useState(false);
  const [detailDiscoverError, setDetailDiscoverError] = useState<string | null>(null);
  const [detailDiscoverResult, setDetailDiscoverResult] = useState<ReleaseDiscoverResult | null>(null);
  const [detailSelectedTag, setDetailSelectedTag] = useState('');

  const lastDiscoveredRepo = useRef<string | null>(null);

  const githubTools = useMemo(() => tools.filter(isGithubTool), [tools]);

  const repoTools = useMemo(
    () => githubTools.filter((t) => t.versionSource.repo === repoFullName),
    [githubTools, repoFullName]
  );

  const latestTaskByTool = useMemo(() => {
    const map = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) {
      const current = map.get(task.toolId);
      if (!current || task.createdAt > current.createdAt) map.set(task.toolId, task);
    }
    return map;
  }, [tasks]);

  const hasInProgressTasks = useMemo(
    () => tasks.some((task) => IN_PROGRESS.has(task.status)),
    [tasks]
  );

  useEffect(() => {
    if (!window.electronAPI) return;
    loadTools().catch(console.error);
    loadTasks().catch(console.error);
  }, [loadTools, loadTasks]);

  useEffect(() => {
    if (!window.electronAPI || !hasInProgressTasks) return;
    const timer = window.setInterval(() => {
      loadTasks().catch(console.error);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [hasInProgressTasks, loadTasks]);

  // Reset form state when repo changes
  useEffect(() => {
    const next: Record<string, ToolSelectState> = {};
    for (const tool of repoTools) {
      next[tool.id] = { selected: false, version: 'latest' };
    }
    setDetailSelection(next);
    setDetailVersions({});
    setDetailVersionLoading({});
    setDetailVersionError({});
    setDetailInstallLoading(false);
    setDetailInstallError(null);
    setDetailInstallLogs([]);
    setDetailToolActionLoading({});
    setDetailAddForm(createDefaultAddFormForRepo(repoFullName, repoTools));
    setDetailAddOverwrite(false);
    setDetailAddLoading(false);
    setDetailAddError(null);
    setDetailAddSuccess(null);
    setDetailDiscoverLoading(false);
    setDetailDiscoverError(null);
    setDetailDiscoverResult(null);
    setDetailSelectedTag('');
    lastDiscoveredRepo.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName]);

  // Auto-discover releases on open
  useEffect(() => {
    if (!window.electronAPI?.release) return;
    if (lastDiscoveredRepo.current === repoFullName) return;
    lastDiscoveredRepo.current = repoFullName;

    setDetailDiscoverLoading(true);
    setDetailDiscoverError(null);
    window.electronAPI.release
      .discoverFromLink({ source: repoFullName, accountId: accountId || undefined })
      .then((result: ReleaseDiscoverResult) => {
        if (result.releases.length === 0) {
          setDetailDiscoverError('No releases found for this repository.');
          return;
        }
        setDetailDiscoverResult(result);
        const preferredTag =
          result.suggestedTag && result.releases.some((r: ReleaseDiscoverResult['releases'][number]) => r.tag === result.suggestedTag)
            ? result.suggestedTag
            : result.releases[0].tag;
        setDetailSelectedTag(preferredTag);
        const selectedRelease = result.releases.find((r: ReleaseDiscoverResult['releases'][number]) => r.tag === preferredTag);
        if (selectedRelease) {
          applyReleaseAssetsToForm(selectedRelease, {
            repo: result.repo,
            suggestedAssetName: result.suggestedAssetName,
          });
        }
      })
      .catch((err: unknown) => {
        setDetailDiscoverError(err instanceof Error ? err.message : 'Failed to fetch releases');
      })
      .finally(() => setDetailDiscoverLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, accountId]);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !detailInstallLoading && !detailAddLoading) onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [detailInstallLoading, detailAddLoading, onClose]);

  const applyReleaseAssetsToForm = (
    release: ReleaseDiscoverResult['releases'][number],
    options?: { repo?: string; suggestedAssetName?: string }
  ) => {
    setDetailAddForm((prev) => {
      if (!prev) return prev;

      const normalizedRepo = normalizeRepo(options?.repo || prev.repo || repoFullName);
      const releaseAssets =
        options?.suggestedAssetName && release.assets.some((a) => a.name === options.suggestedAssetName)
          ? release.assets.filter((a) => a.name === options.suggestedAssetName)
          : release.assets;

      const mappedAssets: RepoAssetRow[] = releaseAssets.map((asset) => ({
        platform: inferAssetPlatform(asset.name),
        arch: inferAssetArch(asset.name),
        type: inferAssetType(asset.name),
        url: toVersionTemplateUrl(asset.downloadUrl, release.tag),
      }));

      const fallbackAsset: RepoAssetRow = {
        platform: 'win',
        arch: 'x64',
        type: 'exe',
        url: `https://github.com/${normalizedRepo}/releases/download/{version}/${prev.id || 'tool'}.exe`,
      };

      const nextAssets = mappedAssets.length > 0 ? mappedAssets : [fallbackAsset];
      const primaryType = nextAssets[0]?.type;
      const nextInstallType: RepoInstallType =
        primaryType === 'msi' ? 'msi' : primaryType === 'pkg' ? 'pkg' : primaryType === 'exe' ? 'exe' : 'archive';
      const repoFallbackName = normalizedRepo ? normalizedRepo.split('/')[1] || 'tool' : 'tool';
      const inferredToolId = inferToolIdFromAsset(releaseAssets[0]?.name || '', repoFallbackName);
      const shouldReplaceId = !prev.id || /-tool(?:-\d+)?$/.test(prev.id);
      const shouldReplaceName = !prev.name || /^[\w-]+-\d+$/.test(prev.name);
      const nextToolId = shouldReplaceId ? inferredToolId : prev.id;
      const nextToolName = shouldReplaceName ? inferredToolId : prev.name;
      const shouldReplaceValidate =
        !prev.validateCommand || prev.validateCommand.trim() === `${prev.id} --version`;

      return {
        ...prev,
        repo: normalizedRepo || prev.repo,
        id: nextToolId,
        name: nextToolName,
        homepage: normalizedRepo ? `https://github.com/${normalizedRepo}` : prev.homepage,
        validateCommand: shouldReplaceValidate ? `${nextToolId} --version` : prev.validateCommand,
        installType: nextInstallType,
        assets: nextAssets,
      };
    });
  };

  const handleSelectDiscoveredRelease = (tag: string) => {
    setDetailSelectedTag(tag);
    if (!detailDiscoverResult) return;
    const release = detailDiscoverResult.releases.find((r) => r.tag === tag);
    if (release) applyReleaseAssetsToForm(release, { repo: detailDiscoverResult.repo });
  };

  const loadVersionsForTool = async (toolId: string, force = false) => {
    if (!window.electronAPI) return;
    if (detailVersionLoading[toolId]) return;
    if (!force && detailVersions[toolId]?.length) return;

    setDetailVersionLoading((prev) => ({ ...prev, [toolId]: true }));
    setDetailVersionError((prev) => ({ ...prev, [toolId]: null }));
    try {
      const versions = await window.electronAPI.catalog.getVersions(toolId);
      setDetailVersions((prev) => ({ ...prev, [toolId]: versions.slice(0, 30) }));
    } catch (err) {
      setDetailVersionError((prev) => ({
        ...prev,
        [toolId]: err instanceof Error ? err.message : 'Failed to load versions',
      }));
    } finally {
      setDetailVersionLoading((prev) => ({ ...prev, [toolId]: false }));
    }
  };

  const handleDetailAddAssetRow = () => {
    setDetailAddForm((prev) => {
      if (!prev) return prev;
      return { ...prev, assets: [...prev.assets, { platform: 'win', arch: 'x64', type: 'exe', url: '' }] };
    });
  };

  const handleDetailRemoveAssetRow = (index: number) => {
    setDetailAddForm((prev) => {
      if (!prev || prev.assets.length <= 1) return prev;
      return { ...prev, assets: prev.assets.filter((_, i) => i !== index) };
    });
  };

  const handleDetailUpdateAssetRow = <K extends keyof RepoAssetRow>(
    index: number,
    key: K,
    value: RepoAssetRow[K]
  ) => {
    setDetailAddForm((prev) => {
      if (!prev) return prev;
      return { ...prev, assets: prev.assets.map((a, i) => (i === index ? { ...a, [key]: value } : a)) };
    });
  };

  const handleSaveDetailRepositoryTool = async () => {
    if (!window.electronAPI || !detailAddForm) return;
    setDetailAddLoading(true);
    setDetailAddError(null);
    setDetailAddSuccess(null);
    try {
      const yaml = buildToolYaml(detailAddForm);
      const createdTool = await window.electronAPI.catalog.addToolDefinition(yaml, {
        overwrite: detailAddOverwrite,
      });
      await loadTools();
      setDetailAddSuccess(`Saved ${createdTool.id} into ${repoFullName}`);
      setDetailAddOverwrite(false);
      setDetailAddForm(
        createDefaultAddFormForRepo(repoFullName, [
          ...repoTools,
          createdTool as GithubTool,
        ])
      );
    } catch (err) {
      setDetailAddError(err instanceof Error ? err.message : 'Failed to add tool for repository');
    } finally {
      setDetailAddLoading(false);
    }
  };

  const appendDetailLog = (message: string) => {
    const time = new Date().toLocaleTimeString();
    setDetailInstallLogs((prev) => [...prev, `[${time}] ${message}`]);
  };

  const handleUninstallTool = async (tool: GithubTool) => {
    if (!window.electronAPI) return;
    setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: true }));
    setDetailInstallError(null);
    appendDetailLog(`Uninstalling ${tool.id}`);
    try {
      const result = await window.electronAPI.installer.uninstall(tool.id);
      await loadTasks();
      if (!result.success) throw new Error(result.error || `Uninstall failed for ${tool.id}`);
      appendDetailLog(`Uninstalled ${tool.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to uninstall tool';
      setDetailInstallError(msg);
      appendDetailLog(`ERROR: ${msg}`);
    } finally {
      setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: false }));
    }
  };

  const handleRemoveToolDefinition = async (tool: GithubTool) => {
    if (!window.electronAPI) return;
    const installState = getToolInstallState(latestTaskByTool.get(tool.id)?.status);
    if (installState === 'installed') {
      setDetailInstallError(`"${tool.id}" is installed. Please uninstall it first.`);
      return;
    }
    if (installState === 'in-progress') {
      setDetailInstallError(`"${tool.id}" is busy. Please wait for the current task to finish.`);
      return;
    }
    if (!window.confirm(`Remove tool definition "${tool.id}" from repository "${repoFullName}"?`)) return;

    setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: true }));
    setDetailInstallError(null);
    try {
      await window.electronAPI.catalog.removeToolDefinition(tool.id);
      await Promise.all([loadTools(), loadTasks()]);
      appendDetailLog(`Removed ${tool.id} from repository`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove tool definition from repository';
      setDetailInstallError(msg);
      appendDetailLog(`ERROR: ${msg}`);
    } finally {
      setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: false }));
    }
  };

  const handleInstallSelected = async () => {
    if (!window.electronAPI) return;
    const queue = repoTools
      .filter((tool) => detailSelection[tool.id]?.selected)
      .map((tool) => ({ tool, version: detailSelection[tool.id]?.version || 'latest' }));

    if (queue.length === 0) {
      setDetailInstallError('Please select at least one tool.');
      return;
    }

    setDetailInstallLoading(true);
    setDetailInstallError(null);
    setDetailInstallLogs([]);
    appendDetailLog(`Queue started: ${queue.length} tool(s)`);

    try {
      for (const item of queue) {
        appendDetailLog(`Installing ${item.tool.id}@${item.version}`);
        const task = await createTask(item.tool.id, item.version);
        const result = await window.electronAPI.installer.start(task.id);
        await loadTasks();
        if (!result.success) throw new Error(result.error || `Install failed for ${item.tool.id}`);
        appendDetailLog(`Installed ${item.tool.id}`);
      }
      appendDetailLog('Batch install completed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Batch install failed';
      setDetailInstallError(msg);
      appendDetailLog(`ERROR: ${msg}`);
    } finally {
      setDetailInstallLoading(false);
      await loadTasks();
    }
  };

  const busy = detailInstallLoading || detailAddLoading;

  return (
    <div
      className="repo-modal-backdrop"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div className="repo-modal repo-modal-xlarge" onClick={(e) => e.stopPropagation()}>
        <div className="repo-modal-header">
          <h2>{repoFullName}</h2>
          <IconButton
            className="repo-modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label={t('repoInstall.close')}
            icon="close"
            label={t('repoInstall.close')}
          />
        </div>

        <div className="repo-modal-body">
          {/* Release Upload link */}
          <section className="repo-detail-block">
            <h3>{t('repoInstall.uploadSection')}</h3>
            <p className="repo-help-text">
              {t('repoInstall.uploadHint')}
            </p>
            <div className="repo-detail-actions">
              <IconButton
                className="btn btn-secondary"
                onClick={() =>
                  navigate(`/repository-upload?repo=${encodeURIComponent(repoFullName)}`)
                }
                icon="upload"
                label={t('repoInstall.openUploadPage')}
              />
            </div>
          </section>

          {/* Add Tool section */}
          <section className="repo-detail-block">
            <div className="repo-tools-header">
              <h3>{t('repoInstall.addToolSection')}</h3>
              {detailDiscoverLoading && <span className="repo-discover-hint">{t('repoInstall.fetchingReleases')}</span>}
              {!detailDiscoverLoading && detailDiscoverResult && (
                <span className="repo-discover-hint">
                  {detailDiscoverResult.releases.length} {t('repoInstall.releasesFound')}
                </span>
              )}
            </div>
            <p className="repo-help-text">
              {t('repoInstall.addToolHint')}
            </p>
            {detailDiscoverError && <p className="repo-error">{t('repoInstall.errorPrefix')} {detailDiscoverError}</p>}
            {detailDiscoverResult && (
              <div className="repo-discover-meta">
                <p className="repo-help-text">
                  {t('repoInstall.detectedReleases')} <strong>{detailDiscoverResult.releases.length}</strong> {t('repoInstall.releasesFrom')}{' '}
                  <strong>{detailDiscoverResult.repo}</strong>。
                </p>
                <label>
                  {t('repoInstall.releaseLabel')}
                  <select
                    value={detailSelectedTag}
                    onChange={(e) => handleSelectDiscoveredRelease(e.target.value)}
                    disabled={detailAddLoading || detailDiscoverLoading}
                  >
                    {detailDiscoverResult.releases.map((release) => (
                      <option key={release.id} value={release.tag}>
                        {release.tag}
                        {release.name ? ` - ${release.name}` : ''}
                        {release.assets.length ? ` (${release.assets.length} ${t('repoInstall.assets')})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {detailAddForm && (
              <>
                <div className="repo-form-grid">
                  <label>
                    {t('repoInstall.toolId')}
                    <input
                      value={detailAddForm.id}
                      onChange={(e) =>
                        setDetailAddForm((prev) =>
                          prev ? { ...prev, id: ensureToolId(e.target.value) } : prev
                        )
                      }
                      placeholder={t('repoInstall.toolIdPlaceholder')}
                      disabled={detailAddLoading}
                    />
                  </label>
                  <label>
                    {t('repoInstall.name')}
                    <input
                      value={detailAddForm.name}
                      onChange={(e) =>
                        setDetailAddForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                      }
                      placeholder={t('repoInstall.namePlaceholder')}
                      disabled={detailAddLoading}
                    />
                  </label>
                  <label>
                    {t('repoInstall.installType')}
                    <select
                      value={detailAddForm.installType}
                      onChange={(e) =>
                        setDetailAddForm((prev) =>
                          prev ? { ...prev, installType: e.target.value as RepoInstallType } : prev
                        )
                      }
                      disabled={detailAddLoading}
                    >
                      <option value="archive">archive</option>
                      <option value="msi">msi</option>
                      <option value="exe">exe</option>
                      <option value="pkg">pkg</option>
                    </select>
                  </label>
                </div>

                <details className="repo-advanced-fields">
                  <summary>{t('repoInstall.advancedFields')}</summary>
                  <div className="repo-form-grid repo-form-grid-advanced">
                    <label className="repo-form-wide">
                      {t('repoInstall.description')}
                      <input
                        value={detailAddForm.description}
                        onChange={(e) =>
                          setDetailAddForm((prev) =>
                            prev ? { ...prev, description: e.target.value } : prev
                          )
                        }
                        placeholder={t('repoInstall.descriptionPlaceholder')}
                        disabled={detailAddLoading}
                      />
                    </label>
                    <label>
                      {t('repoInstall.silentArgs')}
                      <input
                        value={detailAddForm.silentArgs}
                        onChange={(e) =>
                          setDetailAddForm((prev) =>
                            prev ? { ...prev, silentArgs: e.target.value } : prev
                          )
                        }
                        placeholder="/S"
                        disabled={detailAddLoading}
                      />
                    </label>
                    <label className="repo-form-wide">
                      {t('repoInstall.validateCommand')}
                      <input
                        value={detailAddForm.validateCommand}
                        onChange={(e) =>
                          setDetailAddForm((prev) =>
                            prev ? { ...prev, validateCommand: e.target.value } : prev
                          )
                        }
                        placeholder={t('repoInstall.validateCommandPlaceholder')}
                        disabled={detailAddLoading}
                      />
                    </label>
                    <label className="repo-form-wide">
                      {t('repoInstall.tags')}
                      <input
                        value={detailAddForm.tags}
                        onChange={(e) =>
                          setDetailAddForm((prev) => (prev ? { ...prev, tags: e.target.value } : prev))
                        }
                        placeholder="custom,github"
                        disabled={detailAddLoading}
                      />
                    </label>
                    <label className="repo-inline-checkbox repo-form-wide">
                      <input
                        type="checkbox"
                        checked={detailAddForm.requiresAdmin}
                        onChange={(e) =>
                          setDetailAddForm((prev) =>
                            prev ? { ...prev, requiresAdmin: e.target.checked } : prev
                          )
                        }
                        disabled={detailAddLoading}
                      />
                      {t('repoInstall.requiresAdmin')}
                    </label>
                  </div>
                </details>

                <section className="repo-assets-builder">
                  <div className="repo-assets-header">
                    <h3>{t('repoInstall.assetsSection')}</h3>
                    <IconButton
                      className="btn btn-secondary btn-small"
                      onClick={handleDetailAddAssetRow}
                      disabled={detailAddLoading}
                      icon="add"
                      label={t('repoInstall.addAsset')}
                    />
                  </div>
                  {detailAddForm.assets.map((asset, index) => (
                    <div key={`${asset.platform}-${asset.arch}-${index}`} className="repo-asset-row">
                      <select
                        value={asset.platform}
                        onChange={(e) =>
                          handleDetailUpdateAssetRow(index, 'platform', e.target.value as RepoAssetRow['platform'])
                        }
                        disabled={detailAddLoading}
                      >
                        <option value="win">win</option>
                        <option value="mac">mac</option>
                        <option value="linux">linux</option>
                      </select>
                      <select
                        value={asset.arch}
                        onChange={(e) =>
                          handleDetailUpdateAssetRow(index, 'arch', e.target.value as RepoAssetRow['arch'])
                        }
                        disabled={detailAddLoading}
                      >
                        <option value="x64">x64</option>
                        <option value="arm64">arm64</option>
                        <option value="ia32">ia32</option>
                      </select>
                      <select
                        value={asset.type}
                        onChange={(e) =>
                          handleDetailUpdateAssetRow(index, 'type', e.target.value as RepoAssetType)
                        }
                        disabled={detailAddLoading}
                      >
                        <option value="exe">exe</option>
                        <option value="msi">msi</option>
                        <option value="pkg">pkg</option>
                        <option value="zip">zip</option>
                        <option value="tar.gz">tar.gz</option>
                        <option value="dmg">dmg</option>
                      </select>
                      <input
                        value={asset.url}
                        onChange={(e) => handleDetailUpdateAssetRow(index, 'url', e.target.value)}
                        placeholder="https://github.com/owner/repo/releases/download/{version}/tool.exe"
                        disabled={detailAddLoading}
                      />
                      <IconButton
                        className="btn btn-secondary btn-small"
                        onClick={() => handleDetailRemoveAssetRow(index)}
                        disabled={detailAddLoading || detailAddForm.assets.length <= 1}
                        icon="remove"
                        label={t('repoInstall.removeAsset')}
                      />
                    </div>
                  ))}
                </section>

                <label className="repo-inline-checkbox">
                  <input
                    type="checkbox"
                    checked={detailAddOverwrite}
                    onChange={(e) => setDetailAddOverwrite(e.target.checked)}
                    disabled={detailAddLoading}
                  />
                  {t('repoInstall.overwriteTool')}
                </label>

                {detailAddError && <p className="repo-error">{t('repoInstall.errorPrefix')} {detailAddError}</p>}
                {detailAddSuccess && <p className="repo-success">{detailAddSuccess}</p>}

                <div className="repo-modal-actions">
                  <IconButton
                    className="btn btn-primary"
                    onClick={handleSaveDetailRepositoryTool}
                    disabled={detailAddLoading}
                    icon="save"
                    label={detailAddLoading ? t('repoInstall.saving') : t('repoInstall.addToolBtn')}
                  />
                </div>
              </>
            )}
          </section>

          {/* Install existing tools section */}
          {repoTools.length > 0 && (
            <section className="repo-detail-block">
              <div className="repo-tools-header">
                <h3>{t('repoInstall.selectToolsSection')}</h3>
                <IconButton
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    repoTools.forEach((tool) => {
                      loadVersionsForTool(tool.id, true).catch(console.error);
                    });
                  }}
                  disabled={detailInstallLoading}
                  icon="refresh"
                  label={t('repoInstall.refreshVersions')}
                />
              </div>

              <div className="repo-tools-list">
                {repoTools.map((tool) => {
                  const toolTask = latestTaskByTool.get(tool.id);
                  const versions = detailVersions[tool.id] || [];
                  const loadingVersions = detailVersionLoading[tool.id] || false;
                  const versionError = detailVersionError[tool.id] || null;
                  const selection = detailSelection[tool.id] || { selected: false, version: 'latest' };
                  const actionLoading = detailToolActionLoading[tool.id] || false;
                  const installState = getToolInstallState(toolTask?.status);
                  const toolBusy = detailInstallLoading || actionLoading || installState === 'in-progress';

                  return (
                    <article key={tool.id} className="repo-tool-card">
                      <div className="repo-tool-card-header">
                        <label className="repo-inline-checkbox repo-tool-check">
                          <input
                            type="checkbox"
                            checked={selection.selected}
                            onChange={(e) =>
                              setDetailSelection((prev) => ({
                                ...prev,
                                [tool.id]: { ...selection, selected: e.target.checked },
                              }))
                            }
                            disabled={toolBusy}
                          />
                          <span className="repo-tool-title">{tool.name}</span>
                        </label>
                        {toolTask && (
                          <span className={`repo-status repo-status-${getToolStatusTone(toolTask.status)}`}>
                            {toolTask.status}
                            {toolTask.version ? ` (${toolTask.version})` : ''}
                          </span>
                        )}
                      </div>

                      <p className="repo-tool-desc">{tool.description || t('repoInstall.noDescription')}</p>

                      <div className="repo-tool-meta">
                        <code>{tool.id}</code>
                        <span>{tool.install.type}</span>
                        <span>{tool.install.requiresAdmin ? 'admin' : 'user'}</span>
                      </div>

                      {tool.tags && tool.tags.length > 0 && (
                        <div className="repo-tool-tags">
                          {tool.tags.slice(0, 6).map((tag) => (
                            <span key={`${tool.id}-${tag}`} className="repo-tool-tag">{tag}</span>
                          ))}
                        </div>
                      )}

                      <div className="repo-tool-controls">
                        <IconButton
                          className="btn btn-secondary btn-small"
                          onClick={() => loadVersionsForTool(tool.id, true).catch(console.error)}
                          disabled={loadingVersions || toolBusy}
                          icon="refresh"
                          label={loadingVersions ? t('repoInstall.loadingVersions') : t('repoInstall.loadVersions')}
                        />
                        <select
                          value={selection.version}
                          onChange={(e) =>
                            setDetailSelection((prev) => ({
                              ...prev,
                              [tool.id]: { ...selection, version: e.target.value },
                            }))
                          }
                          disabled={loadingVersions || toolBusy}
                        >
                          <option value="latest">{t('repoInstall.latest')}</option>
                          {versions.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </div>

                      <div className="repo-tool-actions">
                        {installState === 'installed' ? (
                          <IconButton
                            className="btn btn-secondary btn-small"
                            onClick={() => handleUninstallTool(tool).catch(console.error)}
                            disabled={toolBusy}
                            icon="uninstall"
                            label={actionLoading ? t('repoInstall.uninstalling') : t('repoInstall.uninstall')}
                          />
                        ) : (
                          <IconButton
                            className="btn btn-danger btn-small"
                            onClick={() => handleRemoveToolDefinition(tool).catch(console.error)}
                            disabled={toolBusy}
                            icon="remove"
                            label={actionLoading ? t('repoInstall.removing') : t('repoInstall.removeFromRepo')}
                          />
                        )}
                        {installState === 'in-progress' && toolTask && (
                          <span className="repo-tool-action-hint">{t('repoInstall.busy')} {toolTask.status}</span>
                        )}
                      </div>

                      {versionError && <p className="repo-error">{t('repoInstall.errorPrefix')} {versionError}</p>}
                    </article>
                  );
                })}
              </div>

              <div className="repo-batch-actions">
                <IconButton
                  className="btn btn-primary"
                  onClick={handleInstallSelected}
                  disabled={detailInstallLoading}
                  icon="install"
                  label={detailInstallLoading ? t('repoInstall.installing') : t('repoInstall.installSelected')}
                />
              </div>

              {detailInstallError && <p className="repo-error">{t('repoInstall.errorPrefix')} {detailInstallError}</p>}
              {detailInstallLogs.length > 0 && (
                <pre className="repo-log-box">{detailInstallLogs.join('\n')}</pre>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
