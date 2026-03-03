export interface GitHubAccountSummary {
  id: string;
  displayName: string;
  username: string;
  host: string;
  hasToken: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export interface GitHubAccountListResult {
  defaultAccountId: string | null;
  accounts: GitHubAccountSummary[];
}

export interface GitHubAccountUpsertRequest {
  id?: string;
  displayName: string;
  username: string;
  host?: string;
  token?: string;
  setAsDefault?: boolean;
}

export interface GitHubAccountCredential {
  accountId: string;
  displayName: string;
  username: string;
  host: string;
  token: string;
}

export interface GitHubAccountBrowserLoginResult {
  account: GitHubAccountSummary;
  created: boolean;
}
