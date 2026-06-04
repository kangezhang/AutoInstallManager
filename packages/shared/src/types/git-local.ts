// Local Git client types — mirror Rust git_local module.

export interface LocalRepoEntry {
  id: string;
  name: string;
  path: string;
  lastOpenedAt?: string | null;
  favorite: boolean;
}

export interface LocalRepoSummary {
  id: string;
  name: string;
  path: string;
  currentBranch?: string | null;
  headSha?: string | null;
  state: string;
  ahead: number;
  behind: number;
  upstream?: string | null;
  changeCount: number;
}

export interface WorkingChange {
  path: string;
  status: string;
  staged: boolean;
  conflicted: boolean;
}

export interface LocalStatus {
  headSha?: string | null;
  currentBranch?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  state: string;
  staged: WorkingChange[];
  unstaged: WorkingChange[];
  conflicted: WorkingChange[];
}

export interface LocalCommit {
  sha: string;
  shortSha: string;
  summary: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorWhen: number;
  parentShas: string[];
  refs: string[];
}

export interface LocalBranch {
  name: string;
  fullName: string;
  isRemote: boolean;
  isHead: boolean;
  upstream?: string | null;
  targetSha?: string | null;
  ahead: number;
  behind: number;
}

export interface LocalRemote {
  name: string;
  fetchUrl?: string | null;
  pushUrl?: string | null;
}

export interface LocalTag {
  name: string;
  targetSha: string;
}

export interface LocalCommitResult {
  sha: string;
  shortSha: string;
  summary: string;
}

export interface LocalCommitOptions {
  message: string;
  stageAll?: boolean;
  authorName?: string | null;
  authorEmail?: string | null;
  allowEmpty?: boolean;
}
