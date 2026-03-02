import { z } from 'zod';

/**
 * Tool reference in profile
 */
export const ProfileToolSchema = z.object({
  id: z.string(),
  version: z.string().optional(),
  versionStrategy: z
    .enum(['exact', 'minor', 'major', 'latest', 'lts'])
    .default('exact'),
  optional: z.boolean().default(false),
});

/**
 * Environment configuration
 */
export const EnvironmentConfigSchema = z.object({
  addToPath: z.boolean().default(true),
  variables: z.record(z.string()).optional(),
});

/**
 * Profile metadata
 */
export const ProfileMetadataSchema = z.object({
  author: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Profile schema
 */
export const ProfileSchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver format'),
  id: z.string().regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().optional(),
  tools: z.array(ProfileToolSchema).min(1),
  environment: EnvironmentConfigSchema.optional(),
  metadata: ProfileMetadataSchema.optional(),
});

/**
 * Type exports
 */
export type ProfileTool = z.infer<typeof ProfileToolSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type ProfileMetadata = z.infer<typeof ProfileMetadataSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
