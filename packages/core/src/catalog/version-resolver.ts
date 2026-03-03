import * as semver from 'semver';
import type { VersionSource } from '@aim/shared';

export interface VersionInfo {
  version: string;
  releaseDate?: Date;
  prerelease: boolean;
  url?: string;
}

export interface ResolveVersionOptions {
  githubToken?: string;
}

export interface VersionSourceResolver {
  resolve(source: VersionSource, options?: ResolveVersionOptions): Promise<VersionInfo[]>;
}

/**
 * GitHub Releases version source resolver
 */
export class GitHubReleasesResolver implements VersionSourceResolver {
  private cache: Map<string, { versions: VersionInfo[]; cachedAt: Date }> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  async resolve(source: VersionSource, options?: ResolveVersionOptions): Promise<VersionInfo[]> {
    if (source.type !== 'githubReleases') {
      throw new Error('Invalid source type for GitHubReleasesResolver');
    }

    const { repo } = source;
    const token = options?.githubToken?.trim() || '';
    const cacheKey = `${repo}#${token ? 'auth' : 'public'}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt.getTime() < this.cacheTTL) {
      return cached.versions;
    }

    // Fetch from GitHub API
    const versions = await this.fetchFromGitHub(repo, token || undefined);

    // Cache the result
    this.cache.set(cacheKey, { versions, cachedAt: new Date() });

    return versions;
  }

  private async fetchFromGitHub(repo: string, githubToken?: string): Promise<VersionInfo[]> {
    const url = `https://api.github.com/repos/${repo}/releases`;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AutoInstallManager',
      };
      if (githubToken?.trim()) {
        headers.Authorization = `Bearer ${githubToken.trim()}`;
      }

      const response = await fetch(url, {
        headers,
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const releases = await response.json() as Array<{
        tag_name: string;
        published_at: string;
        prerelease: boolean;
        html_url: string;
      }>;

      // Parse and filter valid semver versions
      const versions = releases
        .map((release) => {
          // Remove 'v' prefix if present
          const version = release.tag_name.replace(/^v/, '');

          // Validate semver
          if (!semver.valid(version)) {
            return null;
          }

          return {
            version,
            releaseDate: new Date(release.published_at),
            prerelease: release.prerelease || semver.prerelease(version) !== null,
            url: release.html_url,
          } as VersionInfo;
        })
        .filter((v): v is VersionInfo => v !== null);

      return versions;
    } catch (error) {
      throw new Error(
        `Failed to fetch releases from GitHub: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Static list version source resolver
 */
export class StaticListResolver implements VersionSourceResolver {
  async resolve(source: VersionSource): Promise<VersionInfo[]> {
    if (source.type !== 'staticList') {
      throw new Error('Invalid source type for StaticListResolver');
    }

    return source.versions.map((version) => ({
      version,
      prerelease: semver.prerelease(version) !== null,
    }));
  }
}

/**
 * Version source resolver factory
 */
export class VersionResolverFactory {
  private static githubResolver = new GitHubReleasesResolver();
  private static staticResolver = new StaticListResolver();

  static getResolver(source: VersionSource): VersionSourceResolver {
    switch (source.type) {
      case 'githubReleases':
        return this.githubResolver;
      case 'staticList':
        return this.staticResolver;
      case 'customJsonFeed':
        throw new Error('customJsonFeed resolver not implemented yet');
      default:
        throw new Error(`Unknown version source type: ${(source as any).type}`);
    }
  }

  static clearCache(): void {
    this.githubResolver.clearCache();
  }
}

/**
 * Sort versions in descending order (newest first)
 */
export function sortVersions(versions: VersionInfo[]): VersionInfo[] {
  return versions.sort((a, b) => {
    return semver.rcompare(a.version, b.version);
  });
}

/**
 * Filter out prerelease versions
 */
export function filterStableVersions(versions: VersionInfo[]): VersionInfo[] {
  return versions.filter((v) => !v.prerelease);
}

/**
 * Get the latest version
 */
export function getLatestVersion(versions: VersionInfo[], includePrerelease = false): VersionInfo | null {
  const filtered = includePrerelease ? versions : filterStableVersions(versions);
  const sorted = sortVersions(filtered);
  return sorted[0] || null;
}
