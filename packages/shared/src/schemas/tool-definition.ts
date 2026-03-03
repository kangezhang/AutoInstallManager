import { z } from 'zod';

/**
 * Platform types (matching platform.ts definitions)
 */
export const PlatformEnumSchema = z.enum(['win', 'mac', 'linux']);
export const ArchEnumSchema = z.enum(['x64', 'arm64', 'ia32']);

/**
 * Version source schemas
 */
const GitHubReleasesSourceSchema = z.object({
  type: z.literal('githubReleases'),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in format owner/repo'),
});

const StaticListSourceSchema = z.object({
  type: z.literal('staticList'),
  versions: z.array(z.string()).min(1),
});

const CustomJsonFeedSourceSchema = z.object({
  type: z.literal('customJsonFeed'),
  url: z.string().url(),
});

export const VersionSourceSchema = z.discriminatedUnion('type', [
  GitHubReleasesSourceSchema,
  StaticListSourceSchema,
  CustomJsonFeedSourceSchema,
]);

/**
 * Asset schema
 */
export const AssetSchema = z.object({
  platform: PlatformEnumSchema,
  arch: ArchEnumSchema,
  url: z.string(),
  type: z.enum(['msi', 'exe', 'pkg', 'zip', 'tar.gz', 'dmg']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});


/**
 * Post-install action schema
 */
export const PostInstallActionSchema = z.object({
  type: z.enum(['addToPath', 'createShim', 'runCommand']),
  value: z.string().optional(),
});

/**
 * Install configuration schema
 */
export const InstallConfigSchema = z.object({
  type: z.enum(['msi', 'exe', 'pkg', 'archive']),
  requiresAdmin: z.boolean().default(false),
  silentArgs: z.string().optional(),
  targetDir: z.string().optional(),
  postInstall: z.array(PostInstallActionSchema).optional(),
});

/**
 * Validation configuration schema
 */
export const ValidateConfigSchema = z.object({
  command: z.string(),
  parse: z.enum(['semver', 'regex', 'exact']).default('semver'),
  pattern: z.string().optional(),
});

/**
 * Dependency schema
 */
export const DependencySchema = z.object({
  id: z.string(),
  type: z.enum(['hard', 'soft', 'platformOnly']),
  platforms: z.array(PlatformEnumSchema).optional(),
});

/**
 * Optional auth binding for remote sources.
 */
export const ToolAuthSchema = z.object({
  githubAccountId: z.string().min(1).optional(),
});

/**
 * Tool definition schema
 */
export const ToolDefinitionSchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver format'),
  id: z.string().regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  versionSource: VersionSourceSchema,
  assets: z.array(AssetSchema).min(1),
  install: InstallConfigSchema,
  validate: ValidateConfigSchema,
  dependencies: z.array(DependencySchema).optional(),
  auth: ToolAuthSchema.optional(),
});

/**
 * Type exports
 */
export type ToolPlatform = z.infer<typeof PlatformEnumSchema>;
export type ToolArch = z.infer<typeof ArchEnumSchema>;
export type VersionSource = z.infer<typeof VersionSourceSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type PostInstallAction = z.infer<typeof PostInstallActionSchema>;
export type InstallConfig = z.infer<typeof InstallConfigSchema>;
export type ValidateConfig = z.infer<typeof ValidateConfigSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type ToolAuth = z.infer<typeof ToolAuthSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
