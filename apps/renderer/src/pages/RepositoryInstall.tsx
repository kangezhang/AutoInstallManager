import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReleaseDiscoverResult, ToolDefinition } from '@aim/shared';
import { useCatalogStore, useInstallerStore } from '../store';
import './RepositoryInstall.css';

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

const createDefaultAddForm = (): AddRepoForm => ({
  repo: '',
  id: '',
  name: '',
  description: '',
  homepage: '',
  tags: 'custom,github',
  installType: 'exe',
  requiresAdmin: false,
  silentArgs: '/S',
  validateCommand: '',
  assets: [{ platform: 'win', arch: 'x64', type: 'exe', url: '' }],
});

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

export function RepositoryInstall() {
  const navigate = useNavigate();
  const { tools, loading, error, loadTools } = useCatalogStore();
  const { tasks, loadTasks, createTask } = useInstallerStore();

  const [addOpen, setAddOpen] = useState(false);
  const [addOverwrite, setAddOverwrite] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<AddRepoForm>(() => createDefaultAddForm());
  const [addYaml, setAddYaml] = useState('');

  const [detailRepo, setDetailRepo] = useState<string | null>(null);
  const [detailSelection, setDetailSelection] = useState<Record<string, ToolSelectState>>({});
  const [detailVersions, setDetailVersions] = useState<Record<string, string[]>>({});
  const [detailVersionLoading, setDetailVersionLoading] = useState<Record<string, boolean>>({});
  const [detailVersionError, setDetailVersionError] = useState<Record<string, string | null>>({});
  const [detailInstallLoading, setDetailInstallLoading] = useState(false);
  const [detailInstallError, setDetailInstallError] = useState<string | null>(null);
  const [detailInstallLogs, setDetailInstallLogs] = useState<string[]>([]);
  const [detailToolActionLoading, setDetailToolActionLoading] = useState<Record<string, boolean>>(
    {}
  );
  const [detailAddForm, setDetailAddForm] = useState<AddRepoForm | null>(null);
  const [detailAddOverwrite, setDetailAddOverwrite] = useState(false);
  const [detailAddLoading, setDetailAddLoading] = useState(false);
  const [detailAddError, setDetailAddError] = useState<string | null>(null);
  const [detailAddSuccess, setDetailAddSuccess] = useState<string | null>(null);
  const [detailDiscoverSource, setDetailDiscoverSource] = useState('');
  const [detailDiscoverLoading, setDetailDiscoverLoading] = useState(false);
  const [detailDiscoverError, setDetailDiscoverError] = useState<string | null>(null);
  const [detailDiscoverResult, setDetailDiscoverResult] = useState<ReleaseDiscoverResult | null>(null);
  const [detailSelectedTag, setDetailSelectedTag] = useState('');

  const githubTools = useMemo(() => tools.filter(isGithubTool), [tools]);

  const repositories = useMemo(() => {
    const grouped = new Map<string, GithubTool[]>();
    for (const tool of githubTools) {
      const repo = tool.versionSource.repo;
      const current = grouped.get(repo) || [];
      current.push(tool);
      grouped.set(repo, current);
    }

    return Array.from(grouped.entries())
      .map(([repo, repoTools]) => ({ repo, tools: repoTools.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.repo.localeCompare(b.repo));
  }, [githubTools]);

  const detailRepoData = useMemo(
    () => repositories.find((repository) => repository.repo === detailRepo) || null,
    [repositories, detailRepo]
  );

  const latestTaskByTool = useMemo(() => {
    const map = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) {
      const current = map.get(task.toolId);
      if (!current || task.createdAt > current.createdAt) {
        map.set(task.toolId, task);
      }
    }
    return map;
  }, [tasks]);

  const hasInProgressTasks = useMemo(
    () => tasks.some((task) => IN_PROGRESS.has(task.status)),
    [tasks]
  );

  useEffect(() => {
    if (!window.electronAPI) return;
    Promise.all([loadTools(), loadTasks()]).catch((loadError) => {
      console.error('Failed to load repositories page:', loadError);
    });
  }, [loadTools, loadTasks]);

  useEffect(() => {
    if (!window.electronAPI || !hasInProgressTasks) return;

    const timer = window.setInterval(() => {
      loadTasks().catch((tasksError) => {
        console.error('Failed to refresh tasks:', tasksError);
      });
    }, 1200);

    return () => window.clearInterval(timer);
  }, [hasInProgressTasks, loadTasks]);

  useEffect(() => {
    if (!addOpen) return;
    try {
      setAddYaml(buildToolYaml(addForm));
      setAddError(null);
    } catch (yamlError) {
      setAddYaml('');
      setAddError(yamlError instanceof Error ? yamlError.message : 'Invalid tool definition form');
    }
  }, [addOpen, addForm]);

  useEffect(() => {
    if (!detailRepoData) return;

    const next: Record<string, ToolSelectState> = {};
    for (const tool of detailRepoData.tools) {
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
    setDetailAddForm(createDefaultAddFormForRepo(detailRepoData.repo, detailRepoData.tools));
    setDetailAddOverwrite(false);
    setDetailAddLoading(false);
    setDetailAddError(null);
    setDetailAddSuccess(null);
    setDetailDiscoverSource(`https://github.com/${detailRepoData.repo}`);
    setDetailDiscoverLoading(false);
    setDetailDiscoverError(null);
    setDetailDiscoverResult(null);
    setDetailSelectedTag('');
  }, [detailRepoData]);

  useEffect(() => {
    if (!detailRepo) return;
    const onEsc = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !detailInstallLoading &&
        !detailAddLoading
      ) {
        setDetailRepo(null);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [detailRepo, detailInstallLoading, detailAddLoading]);

  useEffect(() => {
    if (!addOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !addLoading) {
        setAddOpen(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [addOpen, addLoading]);

  const appendDetailLog = (message: string) => {
    const time = new Date().toLocaleTimeString();
    setDetailInstallLogs((prev) => [...prev, `[${time}] ${message}`]);
  };

  const applyReleaseAssetsToForm = (
    release: ReleaseDiscoverResult['releases'][number],
    options?: { repo?: string; suggestedAssetName?: string }
  ) => {
    setDetailAddForm((prev) => {
      if (!prev) return prev;

      const normalizedRepo = normalizeRepo(options?.repo || prev.repo || detailRepoData?.repo || '');
      const releaseAssets =
        options?.suggestedAssetName && release.assets.some((asset) => asset.name === options.suggestedAssetName)
          ? release.assets.filter((asset) => asset.name === options.suggestedAssetName)
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
        primaryType === 'msi'
          ? 'msi'
          : primaryType === 'pkg'
            ? 'pkg'
            : primaryType === 'exe'
              ? 'exe'
              : 'archive';
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

  const handleDiscoverReleases = async () => {
    if (!window.electronAPI?.release) return;
    if (!detailDiscoverSource.trim()) {
      setDetailDiscoverError('Please paste a GitHub repository/release/asset link.');
      return;
    }

    setDetailDiscoverLoading(true);
    setDetailDiscoverError(null);
    try {
      const result = await window.electronAPI.release.discoverFromLink({
        source: detailDiscoverSource.trim(),
      });
      if (result.releases.length === 0) {
        throw new Error('No release was found for this source.');
      }

      setDetailDiscoverResult(result);
      const preferredTag =
        result.suggestedTag && result.releases.some((release) => release.tag === result.suggestedTag)
          ? result.suggestedTag
          : result.releases[0].tag;
      setDetailSelectedTag(preferredTag);

      const selectedRelease = result.releases.find((release) => release.tag === preferredTag);
      if (selectedRelease) {
        applyReleaseAssetsToForm(selectedRelease, {
          repo: result.repo,
          suggestedAssetName: result.suggestedAssetName,
        });
      }
    } catch (discoverError) {
      setDetailDiscoverResult(null);
      setDetailSelectedTag('');
      setDetailDiscoverError(
        discoverError instanceof Error ? discoverError.message : 'Failed to detect releases from source link'
      );
    } finally {
      setDetailDiscoverLoading(false);
    }
  };

  const handleSelectDiscoveredRelease = (tag: string) => {
    setDetailSelectedTag(tag);
    if (!detailDiscoverResult) return;
    const selectedRelease = detailDiscoverResult.releases.find((release) => release.tag === tag);
    if (!selectedRelease) return;
    applyReleaseAssetsToForm(selectedRelease, { repo: detailDiscoverResult.repo });
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
    } catch (versionError) {
      setDetailVersionError((prev) => ({
        ...prev,
        [toolId]: versionError instanceof Error ? versionError.message : 'Failed to load versions',
      }));
    } finally {
      setDetailVersionLoading((prev) => ({ ...prev, [toolId]: false }));
    }
  };

  const handleAddAssetRow = () => {
    setAddForm((prev) => ({
      ...prev,
      assets: [...prev.assets, { platform: 'win', arch: 'x64', type: 'exe', url: '' }],
    }));
  };

  const handleRemoveAssetRow = (index: number) => {
    setAddForm((prev) => {
      if (prev.assets.length <= 1) return prev;
      return {
        ...prev,
        assets: prev.assets.filter((_, assetIndex) => assetIndex !== index),
      };
    });
  };

  const handleUpdateAssetRow = <K extends keyof RepoAssetRow>(
    index: number,
    key: K,
    value: RepoAssetRow[K]
  ) => {
    setAddForm((prev) => ({
      ...prev,
      assets: prev.assets.map((asset, assetIndex) =>
        assetIndex === index ? { ...asset, [key]: value } : asset
      ),
    }));
  };
  const handleSaveRepositoryTool = async () => {
    if (!window.electronAPI) return;

    setAddLoading(true);
    setAddError(null);
    setAddSuccess(null);

    try {
      if (!addYaml.trim()) {
        throw new Error('Tool definition is empty.');
      }

      const createdTool = await window.electronAPI.catalog.addToolDefinition(addYaml, {
        overwrite: addOverwrite,
      });

      await loadTools();
      setAddSuccess(`Saved ${createdTool.id} (${createdTool.versionSource.type})`);
      setAddOpen(false);
      setAddForm(createDefaultAddForm());
      setAddOverwrite(false);
    } catch (saveError) {
      setAddError(saveError instanceof Error ? saveError.message : 'Failed to save repository tool');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDetailAddAssetRow = () => {
    setDetailAddForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        assets: [...prev.assets, { platform: 'win', arch: 'x64', type: 'exe', url: '' }],
      };
    });
  };

  const handleDetailRemoveAssetRow = (index: number) => {
    setDetailAddForm((prev) => {
      if (!prev || prev.assets.length <= 1) return prev;
      return {
        ...prev,
        assets: prev.assets.filter((_, assetIndex) => assetIndex !== index),
      };
    });
  };

  const handleDetailUpdateAssetRow = <K extends keyof RepoAssetRow>(
    index: number,
    key: K,
    value: RepoAssetRow[K]
  ) => {
    setDetailAddForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        assets: prev.assets.map((asset, assetIndex) =>
          assetIndex === index ? { ...asset, [key]: value } : asset
        ),
      };
    });
  };

  const handleSaveDetailRepositoryTool = async () => {
    if (!window.electronAPI || !detailRepoData || !detailAddForm) return;

    setDetailAddLoading(true);
    setDetailAddError(null);
    setDetailAddSuccess(null);

    try {
      const yaml = buildToolYaml(detailAddForm);
      const createdTool = await window.electronAPI.catalog.addToolDefinition(yaml, {
        overwrite: detailAddOverwrite,
      });

      await loadTools();
      setDetailAddSuccess(`Saved ${createdTool.id} into ${detailRepoData.repo}`);
      setDetailAddOverwrite(false);
      setDetailAddForm(
        createDefaultAddFormForRepo(detailRepoData.repo, [
          ...detailRepoData.tools,
          createdTool as GithubTool,
        ])
      );
    } catch (saveError) {
      setDetailAddError(
        saveError instanceof Error ? saveError.message : 'Failed to add tool for repository'
      );
    } finally {
      setDetailAddLoading(false);
    }
  };

  const handleUninstallTool = async (tool: GithubTool) => {
    if (!window.electronAPI) return;

    setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: true }));
    setDetailInstallError(null);
    appendDetailLog(`Uninstalling ${tool.id}`);

    try {
      const result = await window.electronAPI.installer.uninstall(tool.id);
      await loadTasks();
      if (!result.success) {
        throw new Error(result.error || `Uninstall failed for ${tool.id}`);
      }
      appendDetailLog(`Uninstalled ${tool.id}`);
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Failed to uninstall tool';
      setDetailInstallError(message);
      appendDetailLog(`ERROR: ${message}`);
    } finally {
      setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: false }));
    }
  };

  const handleRemoveToolDefinition = async (tool: GithubTool) => {
    if (!window.electronAPI || !detailRepoData) return;

    const installState = getToolInstallState(latestTaskByTool.get(tool.id)?.status);
    if (installState === 'installed') {
      setDetailInstallError(`"${tool.id}" is installed. Please uninstall it first.`);
      return;
    }
    if (installState === 'in-progress') {
      setDetailInstallError(`"${tool.id}" is busy. Please wait for the current task to finish.`);
      return;
    }

    const confirmed = window.confirm(
      `Remove tool definition "${tool.id}" from repository "${detailRepoData.repo}"?`
    );
    if (!confirmed) return;

    setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: true }));
    setDetailInstallError(null);

    try {
      await window.electronAPI.catalog.removeToolDefinition(tool.id);
      await Promise.all([loadTools(), loadTasks()]);
      appendDetailLog(`Removed ${tool.id} from repository`);
    } catch (actionError) {
      const message =
        actionError instanceof Error
          ? actionError.message
          : 'Failed to remove tool definition from repository';
      setDetailInstallError(message);
      appendDetailLog(`ERROR: ${message}`);
    } finally {
      setDetailToolActionLoading((prev) => ({ ...prev, [tool.id]: false }));
    }
  };

  const handleInstallSelected = async () => {
    if (!window.electronAPI || !detailRepoData) return;

    const queue = detailRepoData.tools
      .filter((tool) => detailSelection[tool.id]?.selected)
      .map((tool) => ({
        tool,
        version: detailSelection[tool.id]?.version || 'latest',
      }));

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

        if (!result.success) {
          throw new Error(result.error || `Install failed for ${item.tool.id}`);
        }
        appendDetailLog(`Installed ${item.tool.id}`);
      }

      appendDetailLog('Batch install completed.');
    } catch (installError) {
      const message = installError instanceof Error ? installError.message : 'Batch install failed';
      setDetailInstallError(message);
      appendDetailLog(`ERROR: ${message}`);
    } finally {
      setDetailInstallLoading(false);
      await loadTasks();
    }
  };

  return (
    <div className="repo-install">
      <div className="repo-header">
        <h1>Repository Catalog</h1>
        <p>Catalog-style cards. Use Details to upload releases and install selected versions.</p>
      </div>

      <div className="repo-header-actions">
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          Add
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            Promise.all([loadTools(), loadTasks()]).catch((refreshError) => {
              console.error('Failed to refresh repository view:', refreshError);
            });
          }}
        >
          Refresh
        </button>
      </div>

      <div className="repo-summary">
        <span>Repositories: {repositories.length}</span>
        <span>Tools: {githubTools.length}</span>
      </div>

      {error && <div className="repo-alert repo-alert-error">Error: {error}</div>}
      {addSuccess && <div className="repo-alert repo-alert-success">{addSuccess}</div>}

      {loading && <div className="repo-empty">Loading repositories...</div>}

      {!loading && repositories.length === 0 && (
        <div className="repo-empty">No repository cards yet. Click Add to create one.</div>
      )}

      <div className="repo-grid">
        {repositories.map((repository) => (
          <article key={repository.repo} className="repo-card">
            <header className="repo-card-header">
              <h3>{repository.repo}</h3>
              <span>{repository.tools.length} tool(s)</span>
            </header>
            <p className="repo-card-desc">
              {repository.tools.slice(0, 3).map((tool) => tool.name).join(', ')}
              {repository.tools.length > 3 ? ' ...' : ''}
            </p>
            <div className="repo-tags">
              {repository.tools.slice(0, 8).map((tool) => (
                <span key={tool.id} className="repo-tag">
                  {tool.id}
                </span>
              ))}
            </div>
            <div className="repo-card-actions">
              <button className="btn btn-secondary" onClick={() => setDetailRepo(repository.repo)}>
                Details
              </button>
            </div>
          </article>
        ))}
      </div>

      {addOpen && (
        <div
          className="repo-modal-backdrop"
          onClick={() => {
            if (!addLoading) {
              setAddOpen(false);
            }
          }}
        >
          <div className="repo-modal repo-modal-large" onClick={(event) => event.stopPropagation()}>
            <div className="repo-modal-header">
              <h2>Add Repository Tool</h2>
              <button
                className="repo-modal-close"
                onClick={() => setAddOpen(false)}
                disabled={addLoading}
                aria-label="Close add repository modal"
              >
                x
              </button>
            </div>

            <div className="repo-modal-body">
              <div className="repo-form-grid">
                <label>
                  Repository (owner/repo)
                  <input
                    value={addForm.repo}
                    onChange={(event) => {
                      const repoValue = event.target.value;
                      const repo = normalizeRepo(repoValue);
                      const guessedName = repo ? repo.split('/')[1] : '';
                      setAddForm((prev) => ({
                        ...prev,
                        repo: repoValue,
                        id: prev.id || ensureToolId(guessedName),
                        name: prev.name || guessedName,
                        homepage: prev.homepage || (repo ? `https://github.com/${repo}` : ''),
                      }));
                    }}
                    placeholder="owner/repo"
                    disabled={addLoading}
                  />
                </label>

                <label>
                  Tool ID
                  <input
                    value={addForm.id}
                    onChange={(event) =>
                      setAddForm((prev) => ({ ...prev, id: ensureToolId(event.target.value) }))
                    }
                    placeholder="my-tool"
                    disabled={addLoading}
                  />
                </label>

                <label>
                  Name
                  <input
                    value={addForm.name}
                    onChange={(event) =>
                      setAddForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="My Tool"
                    disabled={addLoading}
                  />
                </label>

                <label>
                  Homepage
                  <input
                    value={addForm.homepage}
                    onChange={(event) =>
                      setAddForm((prev) => ({ ...prev, homepage: event.target.value }))
                    }
                    placeholder="https://github.com/owner/repo"
                    disabled={addLoading}
                  />
                </label>

                <label>
                  Install Type
                  <select
                    value={addForm.installType}
                    onChange={(event) =>
                      setAddForm((prev) => ({
                        ...prev,
                        installType: event.target.value as RepoInstallType,
                      }))
                    }
                    disabled={addLoading}
                  >
                    <option value="archive">archive</option>
                    <option value="msi">msi</option>
                    <option value="exe">exe</option>
                    <option value="pkg">pkg</option>
                  </select>
                </label>
              </div>

              <details className="repo-advanced-fields">
                <summary>Advanced Fields (Optional)</summary>
                <div className="repo-form-grid repo-form-grid-advanced">
                  <label className="repo-form-wide">
                    Description
                    <input
                      value={addForm.description}
                      onChange={(event) =>
                        setAddForm((prev) => ({ ...prev, description: event.target.value }))
                      }
                      placeholder="Short description"
                      disabled={addLoading}
                    />
                  </label>

                  <label>
                    Tags (comma separated)
                    <input
                      value={addForm.tags}
                      onChange={(event) =>
                        setAddForm((prev) => ({ ...prev, tags: event.target.value }))
                      }
                      placeholder="custom,github"
                      disabled={addLoading}
                    />
                  </label>

                  <label>
                    Silent Args
                    <input
                      value={addForm.silentArgs}
                      onChange={(event) =>
                        setAddForm((prev) => ({ ...prev, silentArgs: event.target.value }))
                      }
                      placeholder="/S"
                      disabled={addLoading}
                    />
                  </label>

                  <label className="repo-form-wide">
                    Validate Command
                    <input
                      value={addForm.validateCommand}
                      onChange={(event) =>
                        setAddForm((prev) => ({ ...prev, validateCommand: event.target.value }))
                      }
                      placeholder="my-tool --version"
                      disabled={addLoading}
                    />
                  </label>

                  <label className="repo-inline-checkbox repo-form-wide">
                    <input
                      type="checkbox"
                      checked={addForm.requiresAdmin}
                      onChange={(event) =>
                        setAddForm((prev) => ({ ...prev, requiresAdmin: event.target.checked }))
                      }
                      disabled={addLoading}
                    />
                    Requires Admin
                  </label>
                </div>
              </details>

              <section className="repo-assets-builder">
                <div className="repo-assets-header">
                  <h3>Assets</h3>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={handleAddAssetRow}
                    disabled={addLoading}
                  >
                    Add Asset
                  </button>
                </div>

                {addForm.assets.map((asset, index) => (
                  <div key={`${asset.platform}-${asset.arch}-${index}`} className="repo-asset-row">
                    <select
                      value={asset.platform}
                      onChange={(event) =>
                        handleUpdateAssetRow(
                          index,
                          'platform',
                          event.target.value as RepoAssetRow['platform']
                        )
                      }
                      disabled={addLoading}
                    >
                      <option value="win">win</option>
                      <option value="mac">mac</option>
                      <option value="linux">linux</option>
                    </select>
                    <select
                      value={asset.arch}
                      onChange={(event) =>
                        handleUpdateAssetRow(
                          index,
                          'arch',
                          event.target.value as RepoAssetRow['arch']
                        )
                      }
                      disabled={addLoading}
                    >
                      <option value="x64">x64</option>
                      <option value="arm64">arm64</option>
                      <option value="ia32">ia32</option>
                    </select>
                    <select
                      value={asset.type}
                      onChange={(event) =>
                        handleUpdateAssetRow(index, 'type', event.target.value as RepoAssetType)
                      }
                      disabled={addLoading}
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
                      onChange={(event) => handleUpdateAssetRow(index, 'url', event.target.value)}
                      placeholder="https://github.com/owner/repo/releases/download/{version}/tool.exe"
                      disabled={addLoading}
                    />
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => handleRemoveAssetRow(index)}
                      disabled={addLoading || addForm.assets.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </section>

              <div className="repo-yaml-preview">
                <h3>Generated YAML</h3>
                <textarea value={addYaml} readOnly />
              </div>

              <label className="repo-inline-checkbox">
                <input
                  type="checkbox"
                  checked={addOverwrite}
                  onChange={(event) => setAddOverwrite(event.target.checked)}
                  disabled={addLoading}
                />
                Overwrite tool if the same ID already exists
              </label>

              {addError && <p className="repo-error">Error: {addError}</p>}

              <div className="repo-modal-actions">
                <button className="btn btn-secondary" onClick={() => setAddOpen(false)} disabled={addLoading}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveRepositoryTool}
                  disabled={addLoading || !addYaml}
                >
                  {addLoading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {detailRepoData && (
        <div
          className="repo-modal-backdrop"
          onClick={() => {
            if (!detailInstallLoading && !detailAddLoading) {
              setDetailRepo(null);
            }
          }}
        >
          <div className="repo-modal repo-modal-xlarge" onClick={(event) => event.stopPropagation()}>
            <div className="repo-modal-header">
              <h2>{detailRepoData.repo}</h2>
              <button
                className="repo-modal-close"
                onClick={() => setDetailRepo(null)}
                disabled={detailInstallLoading || detailAddLoading}
                aria-label="Close repository details"
              >
                x
              </button>
            </div>

            <div className="repo-modal-body">
              <section className="repo-detail-block">
                <h3>Release Upload</h3>
                <p className="repo-help-text">
                  Upload is moved to a dedicated page to keep this details panel focused on tool setup
                  and installation.
                </p>
                <div className="repo-detail-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() =>
                      navigate(`/repositories/upload?repo=${encodeURIComponent(detailRepoData.repo)}`)
                    }
                  >
                    Open Upload Page
                  </button>
                </div>
              </section>

              <section className="repo-detail-block">
                <div className="repo-tools-header">
                  <h3>Add Tool in This Repository</h3>
                </div>
                <p className="repo-help-text">
                  One repository can contain multiple software artifacts. Add more tool definitions
                  here, then install them below.
                </p>
                <div className="repo-discover-row">
                  <input
                    value={detailDiscoverSource}
                    onChange={(event) => setDetailDiscoverSource(event.target.value)}
                    placeholder="Paste owner/repo, release page URL, or asset download URL"
                    disabled={detailAddLoading || detailDiscoverLoading}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      handleDiscoverReleases().catch((discoverError) => {
                        console.error('Failed to discover releases:', discoverError);
                      });
                    }}
                    disabled={detailAddLoading || detailDiscoverLoading}
                  >
                    {detailDiscoverLoading ? 'Detecting...' : 'Detect Releases'}
                  </button>
                </div>
                {detailDiscoverError && <p className="repo-error">Error: {detailDiscoverError}</p>}
                {detailDiscoverResult && (
                  <div className="repo-discover-meta">
                    <p className="repo-help-text">
                      Detected <strong>{detailDiscoverResult.releases.length}</strong> release(s) from{' '}
                      <strong>{detailDiscoverResult.repo}</strong>.
                    </p>
                    <label>
                      Release
                      <select
                        value={detailSelectedTag}
                        onChange={(event) => handleSelectDiscoveredRelease(event.target.value)}
                        disabled={detailAddLoading || detailDiscoverLoading}
                      >
                        {detailDiscoverResult.releases.map((release) => (
                          <option key={release.id} value={release.tag}>
                            {release.tag}
                            {release.name ? ` - ${release.name}` : ''}
                            {release.assets.length ? ` (${release.assets.length} assets)` : ''}
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
                        Tool ID
                        <input
                          value={detailAddForm.id}
                          onChange={(event) =>
                            setDetailAddForm((prev) =>
                              prev ? { ...prev, id: ensureToolId(event.target.value) } : prev
                            )
                          }
                          placeholder="my-tool"
                          disabled={detailAddLoading}
                        />
                      </label>
                      <label>
                        Name
                        <input
                          value={detailAddForm.name}
                          onChange={(event) =>
                            setDetailAddForm((prev) =>
                              prev ? { ...prev, name: event.target.value } : prev
                            )
                          }
                          placeholder="My Tool"
                          disabled={detailAddLoading}
                        />
                      </label>
                      <label>
                        Install Type
                        <select
                          value={detailAddForm.installType}
                          onChange={(event) =>
                            setDetailAddForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    installType: event.target.value as RepoInstallType,
                                  }
                                : prev
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
                      <summary>Advanced Fields (Optional)</summary>
                      <div className="repo-form-grid repo-form-grid-advanced">
                        <label className="repo-form-wide">
                          Description
                          <input
                            value={detailAddForm.description}
                            onChange={(event) =>
                              setDetailAddForm((prev) =>
                                prev ? { ...prev, description: event.target.value } : prev
                              )
                            }
                            placeholder="Short description"
                            disabled={detailAddLoading}
                          />
                        </label>
                        <label>
                          Silent Args
                          <input
                            value={detailAddForm.silentArgs}
                            onChange={(event) =>
                              setDetailAddForm((prev) =>
                                prev ? { ...prev, silentArgs: event.target.value } : prev
                              )
                            }
                            placeholder="/S"
                            disabled={detailAddLoading}
                          />
                        </label>
                        <label className="repo-form-wide">
                          Validate Command
                          <input
                            value={detailAddForm.validateCommand}
                            onChange={(event) =>
                              setDetailAddForm((prev) =>
                                prev ? { ...prev, validateCommand: event.target.value } : prev
                              )
                            }
                            placeholder="my-tool --version"
                            disabled={detailAddLoading}
                          />
                        </label>
                        <label className="repo-form-wide">
                          Tags (comma separated)
                          <input
                            value={detailAddForm.tags}
                            onChange={(event) =>
                              setDetailAddForm((prev) =>
                                prev ? { ...prev, tags: event.target.value } : prev
                              )
                            }
                            placeholder="custom,github"
                            disabled={detailAddLoading}
                          />
                        </label>
                        <label className="repo-inline-checkbox repo-form-wide">
                          <input
                            type="checkbox"
                            checked={detailAddForm.requiresAdmin}
                            onChange={(event) =>
                              setDetailAddForm((prev) =>
                                prev ? { ...prev, requiresAdmin: event.target.checked } : prev
                              )
                            }
                            disabled={detailAddLoading}
                          />
                          Requires Admin
                        </label>
                      </div>
                    </details>

                    <section className="repo-assets-builder">
                      <div className="repo-assets-header">
                        <h3>Assets</h3>
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={handleDetailAddAssetRow}
                          disabled={detailAddLoading}
                        >
                          Add Asset
                        </button>
                      </div>

                      {detailAddForm.assets.map((asset, index) => (
                        <div key={`${asset.platform}-${asset.arch}-${index}`} className="repo-asset-row">
                          <select
                            value={asset.platform}
                            onChange={(event) =>
                              handleDetailUpdateAssetRow(
                                index,
                                'platform',
                                event.target.value as RepoAssetRow['platform']
                              )
                            }
                            disabled={detailAddLoading}
                          >
                            <option value="win">win</option>
                            <option value="mac">mac</option>
                            <option value="linux">linux</option>
                          </select>
                          <select
                            value={asset.arch}
                            onChange={(event) =>
                              handleDetailUpdateAssetRow(
                                index,
                                'arch',
                                event.target.value as RepoAssetRow['arch']
                              )
                            }
                            disabled={detailAddLoading}
                          >
                            <option value="x64">x64</option>
                            <option value="arm64">arm64</option>
                            <option value="ia32">ia32</option>
                          </select>
                          <select
                            value={asset.type}
                            onChange={(event) =>
                              handleDetailUpdateAssetRow(
                                index,
                                'type',
                                event.target.value as RepoAssetType
                              )
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
                            onChange={(event) =>
                              handleDetailUpdateAssetRow(index, 'url', event.target.value)
                            }
                            placeholder="https://github.com/owner/repo/releases/download/{version}/tool.exe"
                            disabled={detailAddLoading}
                          />
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => handleDetailRemoveAssetRow(index)}
                            disabled={detailAddLoading || detailAddForm.assets.length <= 1}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </section>

                    <label className="repo-inline-checkbox">
                      <input
                        type="checkbox"
                        checked={detailAddOverwrite}
                        onChange={(event) => setDetailAddOverwrite(event.target.checked)}
                        disabled={detailAddLoading}
                      />
                      Overwrite tool if the same ID already exists
                    </label>

                    {detailAddError && <p className="repo-error">Error: {detailAddError}</p>}
                    {detailAddSuccess && <p className="repo-success">{detailAddSuccess}</p>}

                    <div className="repo-modal-actions">
                      <button
                        className="btn btn-primary"
                        onClick={handleSaveDetailRepositoryTool}
                        disabled={detailAddLoading}
                      >
                        {detailAddLoading ? 'Saving...' : 'Add Tool to Repository'}
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="repo-detail-block">
                <div className="repo-tools-header">
                  <h3>Select Tools and Versions</h3>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      detailRepoData.tools.forEach((tool) => {
                        loadVersionsForTool(tool.id, true).catch((loadError) => {
                          console.error(`Failed to refresh versions for ${tool.id}:`, loadError);
                        });
                      });
                    }}
                    disabled={detailInstallLoading}
                  >
                    Refresh Versions
                  </button>
                </div>

                <div className="repo-tools-list">
                  {detailRepoData.tools.map((tool) => {
                    const toolTask = latestTaskByTool.get(tool.id);
                    const versions = detailVersions[tool.id] || [];
                    const loadingVersions = detailVersionLoading[tool.id] || false;
                    const versionError = detailVersionError[tool.id] || null;
                    const selection = detailSelection[tool.id] || { selected: false, version: 'latest' };
                    const actionLoading = detailToolActionLoading[tool.id] || false;
                    const installState = getToolInstallState(toolTask?.status);
                    const busy = detailInstallLoading || actionLoading || installState === 'in-progress';

                    return (
                      <article key={tool.id} className="repo-tool-card">
                        <div className="repo-tool-card-header">
                          <label className="repo-inline-checkbox repo-tool-check">
                            <input
                              type="checkbox"
                              checked={selection.selected}
                              onChange={(event) =>
                                setDetailSelection((prev) => ({
                                  ...prev,
                                  [tool.id]: {
                                    ...selection,
                                    selected: event.target.checked,
                                  },
                                }))
                              }
                              disabled={busy}
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

                        <p className="repo-tool-desc">{tool.description || 'No description provided.'}</p>

                        <div className="repo-tool-meta">
                          <code>{tool.id}</code>
                          <span>{tool.install.type}</span>
                          <span>{tool.install.requiresAdmin ? 'admin' : 'user'}</span>
                        </div>

                        {tool.tags && tool.tags.length > 0 && (
                          <div className="repo-tool-tags">
                            {tool.tags.slice(0, 6).map((tag) => (
                              <span key={`${tool.id}-${tag}`} className="repo-tool-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="repo-tool-controls">
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => {
                              loadVersionsForTool(tool.id, true).catch((loadError) => {
                                console.error(`Failed to load versions for ${tool.id}:`, loadError);
                              });
                            }}
                            disabled={loadingVersions || busy}
                          >
                            {loadingVersions ? 'Loading...' : 'Load Versions'}
                          </button>

                          <select
                            value={selection.version}
                            onChange={(event) =>
                              setDetailSelection((prev) => ({
                                ...prev,
                                [tool.id]: {
                                  ...selection,
                                  version: event.target.value,
                                },
                              }))
                            }
                            disabled={loadingVersions || busy}
                          >
                            <option value="latest">latest</option>
                            {versions.map((version) => (
                              <option key={version} value={version}>
                                {version}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="repo-tool-actions">
                          {installState === 'installed' ? (
                            <button
                              className="btn btn-secondary btn-small"
                              onClick={() => {
                                handleUninstallTool(tool).catch((actionError) => {
                                  console.error(`Failed to uninstall ${tool.id}:`, actionError);
                                });
                              }}
                              disabled={busy}
                            >
                              {actionLoading ? 'Uninstalling...' : 'Uninstall'}
                            </button>
                          ) : (
                            <button
                              className="btn btn-danger btn-small"
                              onClick={() => {
                                handleRemoveToolDefinition(tool).catch((actionError) => {
                                  console.error(`Failed to remove ${tool.id}:`, actionError);
                                });
                              }}
                              disabled={busy}
                            >
                              {actionLoading ? 'Removing...' : 'Remove from Repository'}
                            </button>
                          )}
                          {installState === 'in-progress' && toolTask && (
                            <span className="repo-tool-action-hint">Busy: {toolTask.status}</span>
                          )}
                        </div>

                        {versionError && <p className="repo-error">Error: {versionError}</p>}
                      </article>
                    );
                  })}
                </div>

                <div className="repo-batch-actions">
                  <button className="btn btn-primary" onClick={handleInstallSelected} disabled={detailInstallLoading}>
                    {detailInstallLoading ? 'Installing...' : 'Install Selected'}
                  </button>
                </div>

                {detailInstallError && <p className="repo-error">Error: {detailInstallError}</p>}

                {detailInstallLogs.length > 0 && <pre className="repo-log-box">{detailInstallLogs.join('\n')}</pre>}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
