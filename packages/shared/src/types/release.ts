/**
 * Release upload request payload.
 */
export interface ReleaseUploadRequest {
  repo: string;
  tag: string;
  token?: string;
  accountId?: string;
  filePath: string;
  releaseName?: string;
  createReleaseIfMissing?: boolean;
  overwriteAsset?: boolean;
  draft?: boolean;
  prerelease?: boolean;
}

/**
 * Release upload operation result.
 */
export interface ReleaseUploadResult {
  success: boolean;
  releaseId?: number;
  releaseTag?: string;
  releaseUrl?: string;
  assetId?: number;
  assetName?: string;
  assetDownloadUrl?: string;
  error?: string;
}

/**
 * GitHub release asset metadata for discovery flow.
 */
export interface ReleaseAssetInfo {
  id: number;
  name: string;
  downloadUrl: string;
  contentType?: string;
  size?: number;
}

/**
 * GitHub release metadata for discovery flow.
 */
export interface ReleaseInfo {
  id: number;
  tag: string;
  name?: string;
  publishedAt?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets: ReleaseAssetInfo[];
}

/**
 * Discover releases from a pasted GitHub repository/release/asset link.
 */
export interface ReleaseDiscoverRequest {
  source: string;
  accountId?: string;
}

/**
 * Discovery result with repository and release options.
 */
export interface ReleaseDiscoverResult {
  repo: string;
  releases: ReleaseInfo[];
  suggestedTag?: string;
  suggestedAssetName?: string;
}
