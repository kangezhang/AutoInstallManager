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
