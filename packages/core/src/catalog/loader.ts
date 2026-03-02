import * as fs from 'fs/promises';
import * as path from 'path';
import { CatalogValidator } from './validator.js';
import type { ToolDefinition, ToolPlatform, ToolArch } from '@aim/shared';

export interface CatalogLoadOptions {
  catalogDir: string;
  platform?: ToolPlatform;
  arch?: ToolArch;
}

export interface LoadedCatalog {
  tools: ToolDefinition[];
  loadedAt: Date;
  platform?: ToolPlatform;
  arch?: ToolArch;
}

/**
 * Catalog loader
 */
export class CatalogLoader {
  private validator: CatalogValidator;
  private cache: Map<string, LoadedCatalog> = new Map();

  constructor() {
    this.validator = new CatalogValidator();
  }

  /**
   * Load all tool definitions from catalog directory
   */
  async load(options: CatalogLoadOptions): Promise<LoadedCatalog> {
    const { catalogDir, platform, arch } = options;

    // Check cache
    const cacheKey = this.getCacheKey(catalogDir, platform, arch);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Load all tool definitions
    const tools = await this.validator.loadToolDefinitions(catalogDir);

    // Filter by platform and arch if specified
    const filteredTools = platform && arch
      ? this.filterByPlatform(tools, platform, arch)
      : tools;

    const catalog: LoadedCatalog = {
      tools: filteredTools,
      loadedAt: new Date(),
      platform,
      arch,
    };

    // Cache the result
    this.cache.set(cacheKey, catalog);

    return catalog;
  }

  /**
   * Get a specific tool by ID
   */
  async getTool(
    catalogDir: string,
    toolId: string,
    platform?: ToolPlatform,
    arch?: ToolArch
  ): Promise<ToolDefinition | null> {
    const catalog = await this.load({ catalogDir, platform, arch });
    return catalog.tools.find((tool) => tool.id === toolId) || null;
  }

  /**
   * Search tools by tags
   */
  async searchByTags(
    catalogDir: string,
    tags: string[],
    platform?: ToolPlatform,
    arch?: ToolArch
  ): Promise<ToolDefinition[]> {
    const catalog = await this.load({ catalogDir, platform, arch });
    return catalog.tools.filter((tool) =>
      tool.tags?.some((tag) => tags.includes(tag))
    );
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Filter tools by platform and architecture
   */
  private filterByPlatform(
    tools: ToolDefinition[],
    platform: ToolPlatform,
    arch: ToolArch
  ): ToolDefinition[] {
    return tools
      .map((tool) => {
        // Filter assets that match the platform and arch
        const matchingAssets = tool.assets.filter(
          (asset) => asset.platform === platform && asset.arch === arch
        );

        // If no matching assets, exclude this tool
        if (matchingAssets.length === 0) {
          return null;
        }

        // Return tool with only matching assets
        return {
          ...tool,
          assets: matchingAssets,
        };
      })
      .filter((tool): tool is ToolDefinition => tool !== null);
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    catalogDir: string,
    platform?: ToolPlatform,
    arch?: ToolArch
  ): string {
    return `${catalogDir}:${platform || 'all'}:${arch || 'all'}`;
  }
}

