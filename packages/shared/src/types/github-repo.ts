export interface GitHubRepoCreateRequest {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  addReadme?: boolean;
  gitignoreTemplate?: string;
  licenseTemplate?: string;
  private?: boolean;
  autoInit?: boolean;
  token?: string;
  accountId?: string;
}

export interface GitHubRepoQueryRequest {
  repo: string;
  token?: string;
  accountId?: string;
}

export interface GitHubRepoListMineRequest {
  token?: string;
  accountId?: string;
  perPage?: number;
  maxPages?: number;
}

export interface GitHubRepoCommitsRequest extends GitHubRepoQueryRequest {
  perPage?: number;
  branch?: string;
}

export interface GitHubRepoInfo {
  id: number;
  name: string;
  fullName: string;
  description?: string;
  private: boolean;
  defaultBranch?: string;
  htmlUrl: string;
  sshUrl: string;
  httpsUrl: string;
}

export interface GitHubCommitInfo {
  sha: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
  date?: string;
  htmlUrl: string;
}

export interface GitHubRepoForkRequest {
  repo: string;
  organization?: string;
  name?: string;
  defaultBranchOnly?: boolean;
  token?: string;
  accountId?: string;
}

export interface GitHubRepoCloneRequest {
  repo: string;
  destPath: string;
  branch?: string;
  depth?: number;
  token?: string;
  accountId?: string;
}

export interface GitHubRepoCreateFromFolderRequest {
  folderPath: string;
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  branch?: string;
  commitMessage?: string;
  autoGitignore?: boolean;
  token?: string;
  accountId?: string;
}

export interface GitHubRepoCreateFromFolderResult extends GitOperationResult {
  repo?: GitHubRepoInfo;
  branch?: string;
  commitSha?: string;
  folderPath?: string;
}

export interface GitHubRepoUpsertFileRequest {
  repo: string;
  path: string;
  content: string;
  commitMessage?: string;
  branch?: string;
  overwrite?: boolean;
  token?: string;
  accountId?: string;
}

export interface GitHubRepoUpsertFileResult {
  success: boolean;
  path?: string;
  branch?: string;
  fileSha?: string;
  commitSha?: string;
  htmlUrl?: string;
  created?: boolean;
  error?: string;
}

export interface GitHubPullRequestCreateRequest {
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  maintainerCanModify?: boolean;
  token?: string;
  accountId?: string;
}

export interface GitHubPullRequestInfo {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  draft: boolean;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  head: {
    ref: string;
    sha: string;
    repo?: {
      fullName: string;
    };
  };
  base: {
    ref: string;
    sha: string;
  };
}

export interface GitHubPullRequestListRequest {
  repo: string;
  state?: 'open' | 'closed' | 'all';
  perPage?: number;
  token?: string;
  accountId?: string;
}

export interface GitOperationResult {
  success: boolean;
  output?: string;
  error?: string;
}
