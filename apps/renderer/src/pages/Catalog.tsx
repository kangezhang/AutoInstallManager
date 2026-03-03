import { useEffect, useMemo, useState } from 'react';
import type { GitHubAccountSummary, ReleaseDiscoverResult, ToolDefinition } from '@aim/shared';
import { useCatalogStore, useInstallerStore, useScannerStore } from '../store';
import './Catalog.css';

type AddToolMode = 'form' | 'yaml';
type VersionSourceType = 'staticList' | 'githubReleases';
type ValidateParseType = 'semver' | 'regex' | 'exact';
type InstallType = 'archive' | 'msi' | 'exe' | 'pkg';
type AssetPlatform = 'win' | 'mac' | 'linux';
type AssetArch = 'x64' | 'arm64' | 'ia32';
type AssetType = 'msi' | 'exe' | 'pkg' | 'zip' | 'tar.gz' | 'dmg';
type DependencyType = 'hard' | 'soft' | 'platformOnly';
type InstallPresetType = 'archiveCli' | 'archiveApp' | 'msiSilent' | 'exeSilent' | 'pkgSystem';

interface AssetBuilderRow {
  platform: AssetPlatform;
  arch: AssetArch;
  type: AssetType;
  url: string;
  sha256: string;
}

interface DependencyBuilderRow {
  id: string;
  type: DependencyType;
  platforms: string;
}

interface ToolBuilderState {
  id: string;
  name: string;
  description: string;
  homepage: string;
  tags: string;
  versionSourceType: VersionSourceType;
  staticVersions: string;
  githubRepo: string;
  githubAccountId: string;
  assets: AssetBuilderRow[];
  installType: InstallType;
  requiresAdmin: boolean;
  silentArgs: string;
  targetDir: string;
  validateCommand: string;
  validateParse: ValidateParseType;
  validatePattern: string;
  dependencies: DependencyBuilderRow[];
  postInstallAddToPath: string;
  postInstallCreateShim: string;
  postInstallRunCommand: string;
}

interface InstallPresetDefinition {
  label: string;
  description: string;
  installType: InstallType;
  requiresAdmin: boolean;
  silentArgs: string;
  targetDir: string;
  postInstallAddToPath: string;
  postInstallCreateShim: string;
  postInstallRunCommand: string;
  validateParse: ValidateParseType;
}

type QuickDiscoveryAsset = ReleaseDiscoverResult['releases'][number]['assets'][number];

const splitCsv = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const quoteYaml = (value: string) => `'${value.replace(/'/g, "''")}'`;

const INSTALL_PRESETS: Record<InstallPresetType, InstallPresetDefinition> = {
  archiveCli: {
    label: 'Archive CLI (Recommended)',
    description:
      'For zip/tar.gz command-line tools. Installs into user directory and adds installed path to PATH.',
    installType: 'archive',
    requiresAdmin: false,
    silentArgs: '',
    targetDir: '{LOCALAPPDATA}/Programs/{toolId}',
    postInstallAddToPath: '{installedPath}',
    postInstallCreateShim: '',
    postInstallRunCommand: '',
    validateParse: 'semver',
  },
  archiveApp: {
    label: 'Archive GUI App',
    description:
      'For unpack-and-run desktop apps. Installs into user directory without changing PATH.',
    installType: 'archive',
    requiresAdmin: false,
    silentArgs: '',
    targetDir: '{LOCALAPPDATA}/Programs/{toolId}',
    postInstallAddToPath: '',
    postInstallCreateShim: '',
    postInstallRunCommand: '',
    validateParse: 'semver',
  },
  msiSilent: {
    label: 'MSI Silent Install',
    description: 'Uses typical MSI silent flags. Usually requires admin privileges.',
    installType: 'msi',
    requiresAdmin: true,
    silentArgs: '/quiet /norestart',
    targetDir: '',
    postInstallAddToPath: '',
    postInstallCreateShim: '',
    postInstallRunCommand: '',
    validateParse: 'semver',
  },
  exeSilent: {
    label: 'EXE Silent Install',
    description: 'Uses common NSIS-style silent argument. Adjust if vendor flags differ.',
    installType: 'exe',
    requiresAdmin: false,
    silentArgs: '/S',
    targetDir: '',
    postInstallAddToPath: '',
    postInstallCreateShim: '',
    postInstallRunCommand: '',
    validateParse: 'semver',
  },
  pkgSystem: {
    label: 'PKG (macOS System)',
    description: 'For macOS pkg installers. Usually system-level and admin required.',
    installType: 'pkg',
    requiresAdmin: true,
    silentArgs: '',
    targetDir: '',
    postInstallAddToPath: '',
    postInstallCreateShim: '',
    postInstallRunCommand: '',
    validateParse: 'semver',
  },
};

const INSTALL_PRESET_ORDER: InstallPresetType[] = [
  'archiveCli',
  'archiveApp',
  'msiSilent',
  'exeSilent',
  'pkgSystem',
];

const createEmptyAssetRow = (): AssetBuilderRow => ({
  platform: 'win',
  arch: 'x64',
  type: 'zip',
  url: '',
  sha256: '',
});

const createEmptyDependencyRow = (): DependencyBuilderRow => ({
  id: '',
  type: 'hard',
  platforms: '',
});

const createDefaultBuilderState = (): ToolBuilderState => {
  const suffix = Date.now().toString().slice(-6);
  const id = `custom-tool-${suffix}`;
  return {
    id,
    name: `Custom Tool ${suffix}`,
    description: 'Replace this with your tool description.',
    homepage: 'https://example.com/tool',
    tags: 'custom,runtime',
    versionSourceType: 'staticList',
    staticVersions: '1.0.0',
    githubRepo: '',
    githubAccountId: '',
    assets: [
      {
        platform: 'win',
        arch: 'x64',
        type: 'zip',
        url: 'https://example.com/tool-{version}-win-x64.zip',
        sha256: '',
      },
    ],
    installType: 'archive',
    requiresAdmin: false,
    silentArgs: '',
    targetDir: '{LOCALAPPDATA}/Programs/custom-tool',
    validateCommand: `${id} --version`,
    validateParse: 'semver',
    validatePattern: '',
    dependencies: [],
    postInstallAddToPath: '{installedPath}',
    postInstallCreateShim: '',
    postInstallRunCommand: '',
  };
};

const buildTargetDirFromTemplate = (template: string, toolId: string) =>
  template.replace('{toolId}', toolId.trim() || 'custom-tool');

const buildToolDefinitionYaml = (builder: ToolBuilderState) => {
  const tags = splitCsv(builder.tags);
  const staticVersions = splitCsv(builder.staticVersions);
  const dependencies = builder.dependencies.filter((dependency) => dependency.id.trim());
  const assets =
    builder.assets.length > 0
      ? builder.assets
      : [
          {
            platform: 'win' as AssetPlatform,
            arch: 'x64' as AssetArch,
            type: 'zip' as AssetType,
            url: 'https://example.com/tool-{version}.zip',
            sha256: '',
          },
        ];
  const lines: string[] = [];

  lines.push('schemaVersion: 1.0.0');
  lines.push(`id: ${builder.id.trim() || 'custom-tool'}`);
  lines.push(`name: ${quoteYaml(builder.name.trim() || 'Custom Tool')}`);

  if (builder.description.trim()) {
    lines.push(`description: ${quoteYaml(builder.description.trim())}`);
  }
  if (builder.homepage.trim()) {
    lines.push(`homepage: ${quoteYaml(builder.homepage.trim())}`);
  }

  if (tags.length > 0) {
    lines.push('tags:');
    tags.forEach((tag) => {
      lines.push(`  - ${quoteYaml(tag)}`);
    });
  }

  lines.push('versionSource:');
  if (builder.versionSourceType === 'githubReleases') {
    lines.push('  type: githubReleases');
    lines.push(`  repo: ${quoteYaml(builder.githubRepo.trim() || 'owner/repo')}`);
    if (builder.githubAccountId.trim()) {
      lines.push('auth:');
      lines.push(`  githubAccountId: ${quoteYaml(builder.githubAccountId.trim())}`);
    }
  } else {
    lines.push('  type: staticList');
    lines.push('  versions:');
    (staticVersions.length > 0 ? staticVersions : ['1.0.0']).forEach((version) => {
      lines.push(`    - ${quoteYaml(version)}`);
    });
  }

  lines.push('assets:');
  assets.forEach((asset) => {
    lines.push(`  - platform: ${asset.platform}`);
    lines.push(`    arch: ${asset.arch}`);
    lines.push(`    url: ${quoteYaml(asset.url.trim() || 'https://example.com/tool-{version}.zip')}`);
    lines.push(`    type: ${asset.type}`);
    if (asset.sha256.trim()) {
      lines.push(`    sha256: ${quoteYaml(asset.sha256.trim())}`);
    }
  });

  lines.push('install:');
  lines.push(`  type: ${builder.installType}`);
  lines.push(`  requiresAdmin: ${builder.requiresAdmin ? 'true' : 'false'}`);
  if (builder.silentArgs.trim()) {
    lines.push(`  silentArgs: ${quoteYaml(builder.silentArgs.trim())}`);
  }
  if (builder.targetDir.trim()) {
    lines.push(`  targetDir: ${quoteYaml(builder.targetDir.trim())}`);
  }

  const postInstallLines: string[] = [];
  if (builder.postInstallAddToPath.trim()) {
    postInstallLines.push('  - type: addToPath');
    postInstallLines.push(`    value: ${quoteYaml(builder.postInstallAddToPath.trim())}`);
  }
  if (builder.postInstallCreateShim.trim()) {
    postInstallLines.push('  - type: createShim');
    postInstallLines.push(`    value: ${quoteYaml(builder.postInstallCreateShim.trim())}`);
  }
  if (builder.postInstallRunCommand.trim()) {
    postInstallLines.push('  - type: runCommand');
    postInstallLines.push(`    value: ${quoteYaml(builder.postInstallRunCommand.trim())}`);
  }
  if (postInstallLines.length > 0) {
    lines.push('  postInstall:');
    lines.push(...postInstallLines);
  }

  lines.push('validate:');
  lines.push(`  command: ${quoteYaml(builder.validateCommand.trim() || `${builder.id} --version`)}`);
  lines.push(`  parse: ${builder.validateParse}`);
  if (builder.validateParse === 'regex' && builder.validatePattern.trim()) {
    lines.push(`  pattern: ${quoteYaml(builder.validatePattern.trim())}`);
  }

  if (dependencies.length > 0) {
    lines.push('dependencies:');
    dependencies.forEach((dependency) => {
      lines.push(`  - id: ${quoteYaml(dependency.id.trim())}`);
      lines.push(`    type: ${dependency.type}`);
      if (dependency.type === 'platformOnly') {
        const platforms = splitCsv(dependency.platforms);
        if (platforms.length > 0) {
          lines.push('    platforms:');
          platforms.forEach((platform) => {
            lines.push(`      - ${platform}`);
          });
        }
      }
    });
  }

  return `${lines.join('\n')}\n`;
};

const normalizeGitHubRepoInput = (value: string) => {
  const raw = value.trim().replace(/\.git$/i, '');
  if (!raw) return '';
  const urlMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (urlMatch) return `${urlMatch[1]}/${urlMatch[2]}`;
  const shortMatch = raw.match(/^([^/]+)\/([^/]+)$/);
  return shortMatch ? `${shortMatch[1]}/${shortMatch[2]}` : '';
};

const inferAssetType = (assetName: string): AssetType => {
  const lower = assetName.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tar.gz';
  if (lower.endsWith('.msi')) return 'msi';
  if (lower.endsWith('.exe')) return 'exe';
  if (lower.endsWith('.pkg')) return 'pkg';
  if (lower.endsWith('.dmg')) return 'dmg';
  if (lower.endsWith('.zip')) return 'zip';
  return 'zip';
};

const inferAssetPlatform = (assetName: string): AssetPlatform => {
  const lower = assetName.toLowerCase();
  if (lower.includes('darwin') || lower.includes('mac') || lower.includes('osx')) return 'mac';
  if (lower.includes('linux') || lower.includes('ubuntu') || lower.includes('debian')) return 'linux';
  return 'win';
};

const inferAssetArch = (assetName: string): AssetArch => {
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

const ensureToolId = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

const inferToolIdFromAsset = (assetName: string, fallbackName: string): string => {
  const stripped = assetName
    .replace(/\.(tar\.gz|zip|exe|msi|pkg|dmg)$/i, '')
    .replace(/[-_.]v?\d+(?:\.\d+){1,3}(?:[-_.][0-9A-Za-z]+)*/g, '')
    .replace(/[-_.](windows|win|linux|darwin|mac|osx|amd64|x86_64|x64|arm64|aarch64|ia32|x86)/gi, '')
    .replace(/[-_.]+$/g, '');
  return ensureToolId(stripped || fallbackName) || 'tool';
};

const inferInstallTypeFromAssetType = (assetType: AssetType): InstallType => {
  if (assetType === 'msi') return 'msi';
  if (assetType === 'pkg') return 'pkg';
  if (assetType === 'exe') return 'exe';
  return 'archive';
};

export function Catalog() {
  const { tools, loading, error, loadTools } = useCatalogStore();
  const { createTask, startTask, tasks, loadTasks } = useInstallerStore();
  const { report, scanning, loadLastReport, startScan } = useScannerStore();
  const [detailTool, setDetailTool] = useState<ToolDefinition | null>(null);
  const [detailVersions, setDetailVersions] = useState<string[]>([]);
  const [detailVersionsLoading, setDetailVersionsLoading] = useState(false);
  const [detailVersionsError, setDetailVersionsError] = useState<string | null>(null);
  const [selectedDetailVersion, setSelectedDetailVersion] = useState('latest');
  const [detailInstallLoading, setDetailInstallLoading] = useState(false);
  const [detailInstallError, setDetailInstallError] = useState<string | null>(null);
  const [addToolOpen, setAddToolOpen] = useState(false);
  const [addToolLoading, setAddToolLoading] = useState(false);
  const [addToolError, setAddToolError] = useState<string | null>(null);
  const [addToolOverwrite, setAddToolOverwrite] = useState(false);
  const [addToolMode, setAddToolMode] = useState<AddToolMode>('form');
  const [installPresetType, setInstallPresetType] = useState<InstallPresetType>('archiveCli');
  const [toolBuilder, setToolBuilder] = useState<ToolBuilderState>(() => createDefaultBuilderState());
  const [toolDefinitionContent, setToolDefinitionContent] = useState(() =>
    buildToolDefinitionYaml(createDefaultBuilderState())
  );
  const [uninstallTarget, setUninstallTarget] = useState<ToolDefinition | null>(null);
  const [uninstallConfirmInput, setUninstallConfirmInput] = useState('');
  const [uninstallLoading, setUninstallLoading] = useState(false);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddSource, setQuickAddSource] = useState('');
  const [quickAddResult, setQuickAddResult] = useState<ReleaseDiscoverResult | null>(null);
  const [quickAddSelectedTag, setQuickAddSelectedTag] = useState('');
  const [quickAddToolId, setQuickAddToolId] = useState('');
  const [quickAddToolName, setQuickAddToolName] = useState('');
  const [quickAddAssets, setQuickAddAssets] = useState<AssetBuilderRow[]>([]);
  const [quickAddInstallType, setQuickAddInstallType] = useState<InstallType>('archive');
  const [quickAddOverwrite, setQuickAddOverwrite] = useState(false);
  const [quickAddAccounts, setQuickAddAccounts] = useState<GitHubAccountSummary[]>([]);
  const [quickAddAccountLoading, setQuickAddAccountLoading] = useState(false);
  const [quickAddSelectedAccountId, setQuickAddSelectedAccountId] = useState('');

  useEffect(() => {
    if (!window.electronAPI) return;

    const loadData = async () => {
      await Promise.all([loadTools(), loadTasks()]);
      const lastReport = await loadLastReport();
      if (!lastReport) {
        await startScan();
      }
    };

    loadData().catch((loadError) => {
      console.error('Failed to load catalog page data:', loadError);
    });
  }, [loadTools, loadLastReport, loadTasks, startScan]);

  useEffect(() => {
    if (addToolMode === 'form') {
      setToolDefinitionContent(buildToolDefinitionYaml(toolBuilder));
    }
  }, [toolBuilder, addToolMode]);

  const installedByScanner = useMemo(() => {
    const map = new Map<string, { version: string }>();
    if (!report) return map;

    report.detectedTools.forEach((tool) => {
      if (tool.status === 'installed') {
        map.set(tool.id, { version: tool.version });
      }
    });
    return map;
  }, [report]);

  const latestTaskByTool = useMemo(() => {
    const map = new Map<string, (typeof tasks)[number]>();
    tasks.forEach((task) => {
      const current = map.get(task.toolId);
      if (!current || task.createdAt > current.createdAt) {
        map.set(task.toolId, task);
      }
    });
    return map;
  }, [tasks]);

  const hasInProgressTasks = useMemo(
    () =>
      tasks.some((task) =>
        ['pending', 'downloading', 'installing', 'rolling-back', 'uninstalling'].includes(
          task.status
        )
      ),
    [tasks]
  );

  const installedByTasks = useMemo(() => {
    const map = new Map<string, { version: string }>();
    latestTaskByTool.forEach((task) => {
      if (
        task.status === 'installed' ||
        task.status === 'rolled-back' ||
        task.status === 'uninstalling'
      ) {
        map.set(task.toolId, { version: task.version });
      }
    });
    return map;
  }, [latestTaskByTool]);

  const inProgressToolIds = useMemo(() => {
    const statusSet = new Set([
      'pending',
      'downloading',
      'installing',
      'rolling-back',
      'uninstalling',
    ]);
    return new Set(tasks.filter((task) => statusSet.has(task.status)).map((task) => task.toolId));
  }, [tasks]);
  const detailToolBusy = detailTool ? inProgressToolIds.has(detailTool.id) : false;

  const isToolInstalled = (toolId: string) =>
    installedByScanner.has(toolId) || installedByTasks.has(toolId);

  const getInstalledVersion = (toolId: string) =>
    installedByScanner.get(toolId)?.version || installedByTasks.get(toolId)?.version;

  useEffect(() => {
    if (!detailTool || !window.electronAPI) return;

    let cancelled = false;
    setDetailVersionsLoading(true);
    setDetailVersionsError(null);
    setDetailInstallError(null);
    setSelectedDetailVersion('latest');
    setDetailVersions([]);

    window.electronAPI.catalog
      .getVersions(detailTool.id)
      .then((versions) => {
        if (cancelled) return;
        setDetailVersions(versions.slice(0, 20));
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setDetailVersionsError(
          fetchError instanceof Error ? fetchError.message : 'Failed to load versions'
        );
      })
      .finally(() => {
        if (cancelled) return;
        setDetailVersionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailTool]);

  useEffect(() => {
    if (!detailTool) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !detailInstallLoading) {
        setDetailTool(null);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [detailTool, detailInstallLoading]);

  useEffect(() => {
    if (!addToolOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !addToolLoading) {
        setAddToolOpen(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [addToolOpen, addToolLoading]);

  useEffect(() => {
    if (!quickAddOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !quickAddLoading && !quickAddSaving) {
        setQuickAddOpen(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [quickAddOpen, quickAddLoading, quickAddSaving]);

  useEffect(() => {
    if ((!quickAddOpen && !addToolOpen) || !window.electronAPI?.githubAccount) return;

    let cancelled = false;
    setQuickAddAccountLoading(true);
    window.electronAPI.githubAccount
      .list()
      .then((result) => {
        if (cancelled) return;
        setQuickAddAccounts(result.accounts);
        const defaultAccountId =
          result.defaultAccountId ||
          result.accounts.find((account) => account.isDefault)?.id ||
          result.accounts[0]?.id ||
          '';

        setQuickAddSelectedAccountId((current) => {
          const next = current || defaultAccountId;
          return result.accounts.some((account) => account.id === next) ? next : '';
        });

        if (addToolOpen && defaultAccountId) {
          setToolBuilder((current) => {
            if (current.githubAccountId.trim()) {
              return current;
            }
            return {
              ...current,
              githubAccountId: defaultAccountId,
            };
          });
        }
      })
      .catch((accountError) => {
        if (cancelled) return;
        const message =
          accountError instanceof Error
            ? accountError.message
            : 'Failed to load GitHub accounts';
        if (quickAddOpen) {
          setQuickAddError(message);
        }
        if (addToolOpen) {
          setAddToolError(message);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setQuickAddAccountLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [quickAddOpen, addToolOpen]);

  useEffect(() => {
    if (!window.electronAPI || !hasInProgressTasks) return;

    const timer = window.setInterval(() => {
      loadTasks().catch((tasksError) => {
        console.error('Failed to refresh install tasks:', tasksError);
      });
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasInProgressTasks, loadTasks]);

  useEffect(() => {
    if (!uninstallTarget) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uninstallLoading) {
        setUninstallTarget(null);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [uninstallTarget, uninstallLoading]);

  const handleInstall = async (toolId: string, version = 'latest') => {
    const task = await createTask(toolId, version);
    await startTask(task.id);
  };

  const handleRefreshStatus = async () => {
    await startScan();
    await loadTasks();
  };

  const handleOpenUninstall = (tool: ToolDefinition) => {
    setUninstallTarget(tool);
    setUninstallConfirmInput('');
    setUninstallError(null);
  };

  const handleInstallFromDetail = async () => {
    if (!detailTool) return;

    setDetailInstallLoading(true);
    setDetailInstallError(null);
    try {
      await handleInstall(detailTool.id, selectedDetailVersion || 'latest');
      setDetailTool(null);
    } catch (installError) {
      setDetailInstallError(
        installError instanceof Error ? installError.message : 'Failed to install selected version'
      );
    } finally {
      setDetailInstallLoading(false);
    }
  };

  const uninstallConfirmationText = uninstallTarget ? `REMOVE ${uninstallTarget.id}` : '';
  const uninstallConfirmMatches = uninstallTarget
    ? uninstallConfirmInput.trim() === uninstallConfirmationText
    : false;

  const handleConfirmUninstall = async () => {
    if (!window.electronAPI || !uninstallTarget) return;
    if (!uninstallConfirmMatches) {
      setUninstallError('Type the confirmation text exactly to continue.');
      return;
    }

    setUninstallLoading(true);
    setUninstallError(null);
    try {
      const result = await window.electronAPI.installer.uninstall(uninstallTarget.id);
      if (!result.success) {
        setUninstallError(result.error || 'Failed to uninstall tool');
        return;
      }

      await Promise.all([loadTasks(), startScan()]);
      setUninstallTarget(null);
      setUninstallConfirmInput('');
    } catch (uninstallRequestError) {
      setUninstallError(
        uninstallRequestError instanceof Error
          ? uninstallRequestError.message
          : 'Failed to uninstall tool'
      );
    } finally {
      setUninstallLoading(false);
    }
  };

  const updateBuilder = <K extends keyof ToolBuilderState>(key: K, value: ToolBuilderState[K]) => {
    setToolBuilder((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const updateAsset = <K extends keyof AssetBuilderRow>(
    index: number,
    key: K,
    value: AssetBuilderRow[K]
  ) => {
    setToolBuilder((previous) => ({
      ...previous,
      assets: previous.assets.map((asset, assetIndex) =>
        assetIndex === index ? { ...asset, [key]: value } : asset
      ),
    }));
  };

  const addAsset = () => {
    setToolBuilder((previous) => ({
      ...previous,
      assets: [...previous.assets, createEmptyAssetRow()],
    }));
  };

  const removeAsset = (index: number) => {
    setToolBuilder((previous) => {
      if (previous.assets.length <= 1) {
        return previous;
      }
      return {
        ...previous,
        assets: previous.assets.filter((_, assetIndex) => assetIndex !== index),
      };
    });
  };

  const updateDependency = <K extends keyof DependencyBuilderRow>(
    index: number,
    key: K,
    value: DependencyBuilderRow[K]
  ) => {
    setToolBuilder((previous) => ({
      ...previous,
      dependencies: previous.dependencies.map((dependency, dependencyIndex) =>
        dependencyIndex === index ? { ...dependency, [key]: value } : dependency
      ),
    }));
  };

  const addDependency = () => {
    setToolBuilder((previous) => ({
      ...previous,
      dependencies: [...previous.dependencies, createEmptyDependencyRow()],
    }));
  };

  const removeDependency = (index: number) => {
    setToolBuilder((previous) => ({
      ...previous,
      dependencies: previous.dependencies.filter(
        (_dependency, dependencyIndex) => dependencyIndex !== index
      ),
    }));
  };

  const applyInstallPreset = (presetType: InstallPresetType) => {
    const preset = INSTALL_PRESETS[presetType];
    setToolBuilder((previous) => {
      const normalizedToolId = previous.id.trim() || 'custom-tool';
      return {
        ...previous,
        installType: preset.installType,
        requiresAdmin: preset.requiresAdmin,
        silentArgs: preset.silentArgs,
        targetDir: buildTargetDirFromTemplate(preset.targetDir, normalizedToolId),
        postInstallAddToPath: preset.postInstallAddToPath,
        postInstallCreateShim: preset.postInstallCreateShim,
        postInstallRunCommand: preset.postInstallRunCommand,
        validateCommand: `${normalizedToolId} --version`,
        validateParse: preset.validateParse,
        validatePattern: '',
      };
    });
  };

  const handleOpenAddTool = () => {
    const defaultBuilder = createDefaultBuilderState();
    setAddToolError(null);
    setAddToolOverwrite(false);
    setAddToolMode('form');
    setInstallPresetType('archiveCli');
    setToolBuilder(defaultBuilder);
    setToolDefinitionContent(buildToolDefinitionYaml(defaultBuilder));
    setAddToolOpen(true);
  };

  const handleAddTool = async () => {
    if (!window.electronAPI) return;

    setAddToolLoading(true);
    setAddToolError(null);
    try {
      const createdTool = await window.electronAPI.catalog.addToolDefinition(toolDefinitionContent, {
        overwrite: addToolOverwrite,
      });
      await loadTools();
      setDetailTool(createdTool);
      setAddToolOpen(false);
    } catch (submitError) {
      setAddToolError(submitError instanceof Error ? submitError.message : 'Failed to save tool');
    } finally {
      setAddToolLoading(false);
    }
  };

  const applyQuickReleaseToState = (
    result: ReleaseDiscoverResult,
    tag: string,
    options?: { preserveIdentity?: boolean; preferSuggestedAsset?: boolean }
  ) => {
    const release = result.releases.find((item) => item.tag === tag);
    if (!release) return;

    const releaseAssets =
      options?.preferSuggestedAsset &&
      result.suggestedAssetName &&
      release.assets.some((asset) => asset.name === result.suggestedAssetName)
        ? release.assets.filter((asset) => asset.name === result.suggestedAssetName)
        : release.assets;

    const mappedAssets: AssetBuilderRow[] = releaseAssets.map((asset: QuickDiscoveryAsset) => ({
      platform: inferAssetPlatform(asset.name),
      arch: inferAssetArch(asset.name),
      type: inferAssetType(asset.name),
      url: toVersionTemplateUrl(asset.downloadUrl, release.tag),
      sha256: '',
    }));

    const repoName = result.repo.split('/')[1] || 'tool';
    const inferredToolId = inferToolIdFromAsset(releaseAssets[0]?.name || '', repoName);
    const inferredInstallType = inferInstallTypeFromAssetType(mappedAssets[0]?.type || 'zip');

    setQuickAddSelectedTag(tag);
    setQuickAddAssets(
      mappedAssets.length > 0
        ? mappedAssets
        : [
            {
              platform: 'win',
              arch: 'x64',
              type: 'exe',
              url: `https://github.com/${result.repo}/releases/download/{version}/${inferredToolId}.exe`,
              sha256: '',
            },
          ]
    );
    setQuickAddInstallType(inferredInstallType);
    if (!options?.preserveIdentity) {
      setQuickAddToolId(inferredToolId);
      setQuickAddToolName(inferredToolId);
    }
  };

  const handleOpenQuickAdd = () => {
    setQuickAddOpen(true);
    setQuickAddError(null);
    setQuickAddSource('');
    setQuickAddResult(null);
    setQuickAddSelectedTag('');
    setQuickAddToolId('');
    setQuickAddToolName('');
    setQuickAddAssets([]);
    setQuickAddInstallType('archive');
    setQuickAddOverwrite(false);
    setQuickAddSelectedAccountId('');
  };

  const handleDetectQuickReleases = async () => {
    if (!window.electronAPI?.release) return;
    if (!quickAddSource.trim()) {
      setQuickAddError('Please paste a GitHub repository/release/asset link.');
      return;
    }

    setQuickAddLoading(true);
    setQuickAddError(null);
    try {
      const normalizedRepo = normalizeGitHubRepoInput(quickAddSource);
      const result = await window.electronAPI.release.discoverFromLink({
        source: normalizedRepo || quickAddSource.trim(),
        accountId: quickAddSelectedAccountId || undefined,
      });
      if (result.releases.length === 0) {
        throw new Error('No release found for this source.');
      }

      const preferredTag =
        result.suggestedTag && result.releases.some((release) => release.tag === result.suggestedTag)
          ? result.suggestedTag
          : result.releases[0].tag;

      setQuickAddResult(result);
      applyQuickReleaseToState(result, preferredTag, { preferSuggestedAsset: true });
    } catch (discoverError) {
      setQuickAddResult(null);
      setQuickAddSelectedTag('');
      setQuickAddAssets([]);
      setQuickAddError(
        discoverError instanceof Error ? discoverError.message : 'Failed to detect releases'
      );
    } finally {
      setQuickAddLoading(false);
    }
  };

  const handleSelectQuickRelease = (tag: string) => {
    if (!quickAddResult) return;
    applyQuickReleaseToState(quickAddResult, tag, { preserveIdentity: true });
  };

  const handleSaveQuickTool = async () => {
    if (!window.electronAPI) return;
    if (!quickAddResult) {
      setQuickAddError('Please detect releases first.');
      return;
    }

    const toolId = ensureToolId(quickAddToolId);
    if (!toolId) {
      setQuickAddError('Tool ID cannot be empty.');
      return;
    }
    if (quickAddAssets.length === 0) {
      setQuickAddError('No assets found for this release.');
      return;
    }

    const base = createDefaultBuilderState();
    const requiresAdmin = quickAddInstallType === 'msi' || quickAddInstallType === 'pkg';
    const silentArgs =
      quickAddInstallType === 'msi' ? '/quiet /norestart' : quickAddInstallType === 'exe' ? '/S' : '';

    const quickBuilder: ToolBuilderState = {
      ...base,
      id: toolId,
      name: quickAddToolName.trim() || toolId,
      description: '',
      homepage: `https://github.com/${quickAddResult.repo}`,
      tags: 'custom,github',
      versionSourceType: 'githubReleases',
      staticVersions: '',
      githubRepo: quickAddResult.repo,
      githubAccountId: quickAddSelectedAccountId || '',
      assets: quickAddAssets,
      installType: quickAddInstallType,
      requiresAdmin,
      silentArgs,
      targetDir: quickAddInstallType === 'archive' ? `{LOCALAPPDATA}/Programs/${toolId}` : '',
      validateCommand: `${toolId} --version`,
      validateParse: 'semver',
      validatePattern: '',
      dependencies: [],
      postInstallAddToPath: quickAddInstallType === 'archive' ? '{installedPath}' : '',
      postInstallCreateShim: '',
      postInstallRunCommand: '',
    };

    setQuickAddSaving(true);
    setQuickAddError(null);
    try {
      const yaml = buildToolDefinitionYaml(quickBuilder);
      const createdTool = await window.electronAPI.catalog.addToolDefinition(yaml, {
        overwrite: quickAddOverwrite,
      });
      await loadTools();
      setDetailTool(createdTool);
      setQuickAddOpen(false);
    } catch (saveError) {
      setQuickAddError(saveError instanceof Error ? saveError.message : 'Failed to save tool');
    } finally {
      setQuickAddSaving(false);
    }
  };

  const selectedInstallPreset = INSTALL_PRESETS[installPresetType];

  if (loading) {
    return (
      <div className="catalog">
        <div className="loading">Loading tools...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="catalog">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="catalog">
      <div className="catalog-header">
        <h1>Tool Catalog</h1>
        <p>Browse and install development tools</p>
        <div className="catalog-header-actions">
          <button className="btn btn-primary" onClick={handleOpenQuickAdd}>
            Quick Add from GitHub
          </button>
          <button className="btn btn-primary" onClick={handleOpenAddTool}>
            Add Custom Tool
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              handleRefreshStatus().catch((refreshError) => {
                console.error('Failed to refresh status:', refreshError);
              });
            }}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Refresh Status'}
          </button>
        </div>
      </div>

      {report && (
        <div className="catalog-summary">
          <span>Detected: {report.summary.total}</span>
          <span>Healthy: {report.summary.healthy}</span>
          <span>Warnings: {report.summary.warnings}</span>
          <span>Errors: {report.summary.errors}</span>
        </div>
      )}

      <div className="catalog-grid">
        {tools.map((tool) => {
          const installed = isToolInstalled(tool.id);
          const busy = inProgressToolIds.has(tool.id);
          const latestTask = latestTaskByTool.get(tool.id);
          const latestTaskStatus = latestTask?.status;
          const latestTaskProgress = latestTask?.progress;
          const progressPercent = Math.max(
            0,
            Math.min(100, Math.round(latestTaskProgress?.percent ?? 0))
          );
          const showProgress = Boolean(
            latestTask &&
              ['pending', 'downloading', 'installing', 'rolling-back', 'uninstalling'].includes(
                latestTask.status
              )
          );
          const showFailed = latestTask?.status === 'failed';

          return (
            <div
              key={tool.id}
              className={`tool-card ${installed ? 'tool-card-installed' : ''}`}
            >
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>

              {installed && (
                <div className="tool-installed">
                  Installed
                  {getInstalledVersion(tool.id) ? ` (${getInstalledVersion(tool.id)})` : ''}
                </div>
              )}

              {tool.tags && tool.tags.length > 0 && (
                <div className="tool-tags">
                  {tool.tags.map((tag) => (
                    <span key={tag} className="tool-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="tool-actions">
                {!installed ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      handleInstall(tool.id).catch((installError) => {
                        console.error('Failed to install tool:', installError);
                      });
                    }}
                    disabled={busy}
                  >
                    {busy ? 'Installing...' : 'Install'}
                  </button>
                ) : (
                  <button
                    className="btn btn-danger"
                    onClick={() => handleOpenUninstall(tool)}
                    disabled={busy}
                  >
                    {latestTaskStatus === 'uninstalling' ? 'Uninstalling...' : 'Uninstall'}
                  </button>
                )}

                <button className="btn btn-secondary" onClick={() => setDetailTool(tool)}>
                  Details
                </button>
              </div>

              {showProgress && latestTaskProgress && (
                <div className="tool-progress">
                  <div className="tool-progress-meta">
                    <span>{latestTaskStatus}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="tool-progress-track">
                    <div className="tool-progress-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="tool-progress-message">{latestTaskProgress.message}</div>
                </div>
              )}

              {showFailed && (
                <div className="tool-install-error">
                  Install failed: {latestTask?.error || latestTask?.progress?.message || 'Unknown error'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tools.length === 0 && !loading && <div className="loading">No tools available</div>}

      {scanning && <div className="catalog-scan-hint">Refreshing environment status...</div>}

      {quickAddOpen && (
        <div
          className="catalog-modal-backdrop"
          onClick={() => !quickAddLoading && !quickAddSaving && setQuickAddOpen(false)}
        >
          <div className="catalog-modal" onClick={(event) => event.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>Quick Add from GitHub Release</h2>
              <button
                className="catalog-modal-close"
                onClick={() => setQuickAddOpen(false)}
                aria-label="Close quick add dialog"
                disabled={quickAddLoading || quickAddSaving}
              >
                x
              </button>
            </div>

            <div className="catalog-modal-body">
              <p>Paste repository/release/asset link, detect releases, then save as a tool definition.</p>

              <label className="catalog-quick-account">
                GitHub Account (optional, for private repos)
                <select
                  value={quickAddSelectedAccountId}
                  onChange={(event) => setQuickAddSelectedAccountId(event.target.value)}
                  disabled={quickAddLoading || quickAddSaving || quickAddAccountLoading}
                >
                  <option value="">Use default / public access</option>
                  {quickAddAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName} ({account.username}@{account.host})
                      {account.isDefault ? ' [default]' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="catalog-quick-row">
                <input
                  value={quickAddSource}
                  onChange={(event) => setQuickAddSource(event.target.value)}
                  placeholder="owner/repo or https://github.com/owner/repo/releases/..."
                  disabled={quickAddLoading || quickAddSaving}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    handleDetectQuickReleases().catch((discoverError) => {
                      console.error('Failed to detect releases:', discoverError);
                    });
                  }}
                  disabled={quickAddLoading || quickAddSaving}
                >
                  {quickAddLoading ? 'Detecting...' : 'Detect Releases'}
                </button>
              </div>

              {quickAddResult && (
                <div className="catalog-quick-grid">
                  <label className="catalog-quick-wide">
                    Repository
                    <input value={quickAddResult.repo} readOnly />
                  </label>
                  <label className="catalog-quick-wide">
                    Release
                    <select
                      value={quickAddSelectedTag}
                      onChange={(event) => handleSelectQuickRelease(event.target.value)}
                      disabled={quickAddSaving}
                    >
                      {quickAddResult.releases.map((release) => (
                        <option key={release.id} value={release.tag}>
                          {release.tag}
                          {release.assets.length ? ` (${release.assets.length} assets)` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tool ID
                    <input
                      value={quickAddToolId}
                      onChange={(event) => setQuickAddToolId(event.target.value)}
                      disabled={quickAddSaving}
                    />
                  </label>
                  <label>
                    Name
                    <input
                      value={quickAddToolName}
                      onChange={(event) => setQuickAddToolName(event.target.value)}
                      disabled={quickAddSaving}
                    />
                  </label>
                  <label>
                    Install Type
                    <select
                      value={quickAddInstallType}
                      onChange={(event) => setQuickAddInstallType(event.target.value as InstallType)}
                      disabled={quickAddSaving}
                    >
                      <option value="archive">archive</option>
                      <option value="msi">msi</option>
                      <option value="exe">exe</option>
                      <option value="pkg">pkg</option>
                    </select>
                  </label>
                </div>
              )}

              {quickAddAssets.length > 0 && (
                <div className="catalog-quick-assets">
                  {quickAddAssets.slice(0, 8).map((asset, index) => (
                    <div key={`${asset.url}-${index}`} className="catalog-quick-asset">
                      {asset.platform}/{asset.arch} - {asset.type}
                    </div>
                  ))}
                </div>
              )}

              <label className="catalog-checkbox">
                <input
                  type="checkbox"
                  checked={quickAddOverwrite}
                  onChange={(event) => setQuickAddOverwrite(event.target.checked)}
                  disabled={quickAddSaving}
                />
                Overwrite existing tool with the same ID
              </label>

              {quickAddError && <p className="error">Error: {quickAddError}</p>}

              <div className="catalog-modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setQuickAddOpen(false)}
                  disabled={quickAddLoading || quickAddSaving}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    handleSaveQuickTool().catch((saveError) => {
                      console.error('Failed to save quick tool:', saveError);
                    });
                  }}
                  disabled={quickAddLoading || quickAddSaving || !quickAddResult}
                >
                  {quickAddSaving ? 'Saving...' : 'Save from Release'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {addToolOpen && (
        <div className="catalog-modal-backdrop" onClick={() => !addToolLoading && setAddToolOpen(false)}>
          <div className="catalog-modal catalog-modal-large" onClick={(event) => event.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>Add Custom Tool Definition</h2>
              <button
                className="catalog-modal-close"
                onClick={() => setAddToolOpen(false)}
                aria-label="Close add tool dialog"
                disabled={addToolLoading}
              >
                x
              </button>
            </div>

            <div className="catalog-modal-body">
              <p>
                You can build the tool definition from form fields, then switch to YAML mode for manual
                edits before saving.
              </p>

              <div className="tool-mode-tabs">
                <button
                  className={`btn ${addToolMode === 'form' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setAddToolMode('form')}
                  disabled={addToolLoading}
                >
                  Form Builder
                </button>
                <button
                  className={`btn ${addToolMode === 'yaml' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setAddToolMode('yaml')}
                  disabled={addToolLoading}
                >
                  YAML Editor
                </button>
              </div>

              {addToolMode === 'form' && (
                <div className="tool-builder">
                  <div className="tool-builder-grid">
                    <label>
                      Tool ID
                      <input
                        value={toolBuilder.id}
                        onChange={(event) => updateBuilder('id', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label>
                      Name
                      <input
                        value={toolBuilder.name}
                        onChange={(event) => updateBuilder('name', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label className="tool-builder-wide">
                      Description
                      <input
                        value={toolBuilder.description}
                        onChange={(event) => updateBuilder('description', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label className="tool-builder-wide">
                      Homepage
                      <input
                        value={toolBuilder.homepage}
                        onChange={(event) => updateBuilder('homepage', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label className="tool-builder-wide">
                      Tags (comma separated)
                      <input
                        value={toolBuilder.tags}
                        onChange={(event) => updateBuilder('tags', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>

                    <label>
                      Version Source
                      <select
                        value={toolBuilder.versionSourceType}
                        onChange={(event) =>
                          updateBuilder('versionSourceType', event.target.value as VersionSourceType)
                        }
                        disabled={addToolLoading}
                      >
                        <option value="staticList">staticList</option>
                        <option value="githubReleases">githubReleases</option>
                      </select>
                    </label>
                    {toolBuilder.versionSourceType === 'staticList' ? (
                      <label className="tool-builder-wide">
                        Versions (comma separated)
                        <input
                          value={toolBuilder.staticVersions}
                          onChange={(event) => updateBuilder('staticVersions', event.target.value)}
                          disabled={addToolLoading}
                        />
                      </label>
                    ) : (
                      <>
                        <label className="tool-builder-wide">
                          GitHub Repo (owner/repo)
                          <input
                            value={toolBuilder.githubRepo}
                            onChange={(event) => updateBuilder('githubRepo', event.target.value)}
                            disabled={addToolLoading}
                          />
                        </label>
                        <label className="tool-builder-wide">
                          GitHub Account Binding (optional, for private repos)
                          <select
                            value={toolBuilder.githubAccountId}
                            onChange={(event) => updateBuilder('githubAccountId', event.target.value)}
                            disabled={addToolLoading || quickAddAccountLoading}
                          >
                            <option value="">Use default / public access</option>
                            {quickAddAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.displayName} ({account.username}@{account.host})
                                {account.isDefault ? ' [default]' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}

                    <div className="tool-builder-wide tool-builder-subsection">
                      <div className="tool-builder-subsection-header">
                        <h3>Assets</h3>
                        <button className="btn btn-secondary btn-mini" onClick={addAsset} disabled={addToolLoading}>
                          Add Asset
                        </button>
                      </div>
                      {toolBuilder.assets.map((asset, assetIndex) => (
                        <div className="tool-builder-row" key={`${assetIndex}-${asset.platform}-${asset.arch}`}>
                          <label>
                            Platform
                            <select
                              value={asset.platform}
                              onChange={(event) =>
                                updateAsset(assetIndex, 'platform', event.target.value as AssetPlatform)
                              }
                              disabled={addToolLoading}
                            >
                              <option value="win">win</option>
                              <option value="mac">mac</option>
                              <option value="linux">linux</option>
                            </select>
                          </label>
                          <label>
                            Arch
                            <select
                              value={asset.arch}
                              onChange={(event) =>
                                updateAsset(assetIndex, 'arch', event.target.value as AssetArch)
                              }
                              disabled={addToolLoading}
                            >
                              <option value="x64">x64</option>
                              <option value="arm64">arm64</option>
                              <option value="ia32">ia32</option>
                            </select>
                          </label>
                          <label>
                            Type
                            <select
                              value={asset.type}
                              onChange={(event) =>
                                updateAsset(assetIndex, 'type', event.target.value as AssetType)
                              }
                              disabled={addToolLoading}
                            >
                              <option value="zip">zip</option>
                              <option value="tar.gz">tar.gz</option>
                              <option value="msi">msi</option>
                              <option value="exe">exe</option>
                              <option value="pkg">pkg</option>
                              <option value="dmg">dmg</option>
                            </select>
                          </label>
                          <label className="tool-builder-wide">
                            URL
                            <input
                              value={asset.url}
                              onChange={(event) => updateAsset(assetIndex, 'url', event.target.value)}
                              disabled={addToolLoading}
                            />
                          </label>
                          <label className="tool-builder-wide">
                            SHA256 (optional)
                            <input
                              value={asset.sha256}
                              onChange={(event) => updateAsset(assetIndex, 'sha256', event.target.value)}
                              disabled={addToolLoading}
                            />
                          </label>
                          <div className="tool-builder-row-actions">
                            <button
                              className="btn btn-secondary btn-mini"
                              onClick={() => removeAsset(assetIndex)}
                              disabled={addToolLoading || toolBuilder.assets.length <= 1}
                            >
                              Remove Asset
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="tool-builder-wide tool-builder-subsection">
                      <div className="tool-builder-subsection-header">
                        <h3>Install Template</h3>
                        <button
                          className="btn btn-secondary btn-mini"
                          onClick={() => applyInstallPreset(installPresetType)}
                          disabled={addToolLoading}
                        >
                          Apply Template
                        </button>
                      </div>
                      <label className="tool-builder-wide">
                        Template
                        <select
                          value={installPresetType}
                          onChange={(event) =>
                            setInstallPresetType(event.target.value as InstallPresetType)
                          }
                          disabled={addToolLoading}
                        >
                          {INSTALL_PRESET_ORDER.map((presetType) => (
                            <option key={presetType} value={presetType}>
                              {INSTALL_PRESETS[presetType].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="tool-builder-empty">{selectedInstallPreset.description}</p>
                    </div>

                    <label>
                      Install Type
                      <select
                        value={toolBuilder.installType}
                        onChange={(event) => updateBuilder('installType', event.target.value as InstallType)}
                        disabled={addToolLoading}
                      >
                        <option value="archive">archive</option>
                        <option value="msi">msi</option>
                        <option value="exe">exe</option>
                        <option value="pkg">pkg</option>
                      </select>
                    </label>
                    <label className="tool-builder-inline">
                      <input
                        type="checkbox"
                        checked={toolBuilder.requiresAdmin}
                        onChange={(event) => updateBuilder('requiresAdmin', event.target.checked)}
                        disabled={addToolLoading}
                      />
                      Requires Admin
                    </label>
                    <label className="tool-builder-wide">
                      Silent Args (optional)
                      <input
                        value={toolBuilder.silentArgs}
                        onChange={(event) => updateBuilder('silentArgs', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label className="tool-builder-wide">
                      Target Dir
                      <input
                        value={toolBuilder.targetDir}
                        onChange={(event) => updateBuilder('targetDir', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>

                    <label className="tool-builder-wide">
                      Validate Command
                      <input
                        value={toolBuilder.validateCommand}
                        onChange={(event) => updateBuilder('validateCommand', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label>
                      Validate Parse
                      <select
                        value={toolBuilder.validateParse}
                        onChange={(event) =>
                          updateBuilder('validateParse', event.target.value as ValidateParseType)
                        }
                        disabled={addToolLoading}
                      >
                        <option value="semver">semver</option>
                        <option value="regex">regex</option>
                        <option value="exact">exact</option>
                      </select>
                    </label>
                    <label>
                      Validate Pattern
                      <input
                        value={toolBuilder.validatePattern}
                        onChange={(event) => updateBuilder('validatePattern', event.target.value)}
                        disabled={addToolLoading || toolBuilder.validateParse !== 'regex'}
                      />
                    </label>

                    <div className="tool-builder-wide tool-builder-subsection">
                      <div className="tool-builder-subsection-header">
                        <h3>Dependencies</h3>
                        <button
                          className="btn btn-secondary btn-mini"
                          onClick={addDependency}
                          disabled={addToolLoading}
                        >
                          Add Dependency
                        </button>
                      </div>
                      {toolBuilder.dependencies.length === 0 && (
                        <p className="tool-builder-empty">No dependencies configured.</p>
                      )}
                      {toolBuilder.dependencies.map((dependency, dependencyIndex) => (
                        <div className="tool-builder-row" key={`${dependencyIndex}-${dependency.id}`}>
                          <label>
                            Tool ID
                            <input
                              value={dependency.id}
                              onChange={(event) =>
                                updateDependency(dependencyIndex, 'id', event.target.value)
                              }
                              disabled={addToolLoading}
                            />
                          </label>
                          <label>
                            Type
                            <select
                              value={dependency.type}
                              onChange={(event) =>
                                updateDependency(
                                  dependencyIndex,
                                  'type',
                                  event.target.value as DependencyType
                                )
                              }
                              disabled={addToolLoading}
                            >
                              <option value="hard">hard</option>
                              <option value="soft">soft</option>
                              <option value="platformOnly">platformOnly</option>
                            </select>
                          </label>
                          <label className="tool-builder-wide">
                            Platforms (comma separated, only for platformOnly)
                            <input
                              value={dependency.platforms}
                              onChange={(event) =>
                                updateDependency(dependencyIndex, 'platforms', event.target.value)
                              }
                              disabled={addToolLoading || dependency.type !== 'platformOnly'}
                            />
                          </label>
                          <div className="tool-builder-row-actions">
                            <button
                              className="btn btn-secondary btn-mini"
                              onClick={() => removeDependency(dependencyIndex)}
                              disabled={addToolLoading}
                            >
                              Remove Dependency
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <label className="tool-builder-wide">
                      Post Install addToPath (optional)
                      <input
                        value={toolBuilder.postInstallAddToPath}
                        onChange={(event) => updateBuilder('postInstallAddToPath', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label className="tool-builder-wide">
                      Post Install createShim (optional)
                      <input
                        value={toolBuilder.postInstallCreateShim}
                        onChange={(event) => updateBuilder('postInstallCreateShim', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                    <label className="tool-builder-wide">
                      Post Install runCommand (optional)
                      <input
                        value={toolBuilder.postInstallRunCommand}
                        onChange={(event) => updateBuilder('postInstallRunCommand', event.target.value)}
                        disabled={addToolLoading}
                      />
                    </label>
                  </div>

                  <div className="tool-builder-preview">
                    <h3>Generated YAML</h3>
                    <textarea className="tool-definition-editor" value={toolDefinitionContent} readOnly />
                  </div>
                </div>
              )}

              {addToolMode === 'yaml' && (
                <textarea
                  className="tool-definition-editor"
                  value={toolDefinitionContent}
                  onChange={(event) => setToolDefinitionContent(event.target.value)}
                  spellCheck={false}
                />
              )}

              <label className="catalog-checkbox">
                <input
                  type="checkbox"
                  checked={addToolOverwrite}
                  onChange={(event) => setAddToolOverwrite(event.target.checked)}
                />
                Overwrite existing tool with the same ID
              </label>

              {addToolError && <p className="error">Error: {addToolError}</p>}

              <div className="catalog-modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setAddToolOpen(false)}
                  disabled={addToolLoading}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    handleAddTool().catch((submitError) => {
                      console.error('Failed to add custom tool:', submitError);
                    });
                  }}
                  disabled={addToolLoading}
                >
                  {addToolLoading ? 'Saving...' : 'Save Tool Definition'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {uninstallTarget && (
        <div
          className="catalog-modal-backdrop"
          onClick={() => !uninstallLoading && setUninstallTarget(null)}
        >
          <div className="catalog-modal" onClick={(event) => event.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>Confirm Uninstall</h2>
              <button
                className="catalog-modal-close"
                onClick={() => setUninstallTarget(null)}
                aria-label="Close uninstall dialog"
                disabled={uninstallLoading}
              >
                x
              </button>
            </div>

            <div className="catalog-modal-body">
              <p>
                You are about to remove <strong>{uninstallTarget.name}</strong> from this machine.
              </p>
              <p>
                To confirm, type <code>{uninstallConfirmationText}</code> below.
              </p>
              <input
                className="catalog-confirm-input"
                value={uninstallConfirmInput}
                onChange={(event) => setUninstallConfirmInput(event.target.value)}
                placeholder={uninstallConfirmationText}
                disabled={uninstallLoading}
                autoFocus
              />
              {uninstallError && <p className="error">Error: {uninstallError}</p>}

              <div className="catalog-modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setUninstallTarget(null)}
                  disabled={uninstallLoading}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    handleConfirmUninstall().catch((uninstallRequestError) => {
                      console.error('Failed to uninstall tool:', uninstallRequestError);
                    });
                  }}
                  disabled={uninstallLoading || !uninstallConfirmMatches}
                >
                  {uninstallLoading ? 'Uninstalling...' : 'Confirm Uninstall'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailTool && (
        <div
          className="catalog-modal-backdrop"
          onClick={() => {
            if (!detailInstallLoading) {
              setDetailTool(null);
            }
          }}
        >
          <div className="catalog-modal" onClick={(event) => event.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>{detailTool.name}</h2>
              <button
                className="catalog-modal-close"
                onClick={() => setDetailTool(null)}
                aria-label="Close details"
                disabled={detailInstallLoading}
              >
                x
              </button>
            </div>

            <div className="catalog-modal-body">
              <p>{detailTool.description || 'No description provided.'}</p>

              {detailTool.homepage && (
                <p>
                  Homepage:{' '}
                  <a href={detailTool.homepage} target="_blank" rel="noreferrer">
                    {detailTool.homepage}
                  </a>
                </p>
              )}

              <p>
                Install type: <strong>{detailTool.install.type}</strong>
                {detailTool.install.requiresAdmin ? ' (admin required)' : ' (no admin required)'}
              </p>

              {detailTool.install.targetDir && (
                <p>
                  Target directory template: <code>{detailTool.install.targetDir}</code>
                </p>
              )}

              <p>
                Validate command: <code>{detailTool.validate.command}</code>
              </p>

              <div className="catalog-modal-section">
                <h3>Supported Assets</h3>
                <ul>
                  {detailTool.assets.map((asset) => (
                    <li key={`${asset.platform}-${asset.arch}-${asset.type}`}>
                      {asset.platform}/{asset.arch} - {asset.type}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="catalog-modal-section">
                <h3>Available Versions</h3>
                {detailVersionsLoading && <p>Loading versions...</p>}
                {detailVersionsError && <p className="error">Error: {detailVersionsError}</p>}
                {!detailVersionsLoading && !detailVersionsError && detailVersions.length === 0 && (
                  <p>No version data available.</p>
                )}
                <label className="catalog-version-picker">
                  Version to install
                  <select
                    value={selectedDetailVersion}
                    onChange={(event) => setSelectedDetailVersion(event.target.value)}
                    disabled={detailVersionsLoading || detailInstallLoading || detailToolBusy}
                  >
                    <option value="latest">latest (recommended)</option>
                    {detailVersions.map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="catalog-version-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      handleInstallFromDetail().catch((installError) => {
                        console.error('Failed to install selected version:', installError);
                      });
                    }}
                    disabled={detailInstallLoading || detailVersionsLoading || detailToolBusy}
                  >
                    {detailInstallLoading || detailToolBusy ? 'Installing...' : 'Install Selected Version'}
                  </button>
                </div>
                {detailInstallError && <p className="error">Error: {detailInstallError}</p>}
                {!detailVersionsLoading && detailVersions.length > 0 && (
                  <ul>
                    {detailVersions.map((version) => (
                      <li key={version}>{version}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
