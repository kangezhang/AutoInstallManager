import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { app, safeStorage } from 'electron';
import type {
  GitHubAccountBrowserLoginResult,
  GitHubAccountCredential,
  GitHubAccountListResult,
  GitHubAccountSummary,
  GitHubAccountUpsertRequest,
} from '@aim/shared';

interface StoredGitHubAccount {
  id: string;
  displayName: string;
  username: string;
  host: string;
  tokenEncrypted: string;
  createdAt: string;
  updatedAt: string;
}

interface GitHubAccountStore {
  defaultAccountId: string | null;
  accounts: StoredGitHubAccount[];
}

const STORE_FILE_NAME = 'github-accounts.json';

const getStorePath = () => path.join(app.getPath('userData'), STORE_FILE_NAME);

const normalizeHost = (host: string | undefined) => {
  const value = (host || 'github.com').trim().toLowerCase();
  return value || 'github.com';
};

const runGitCredentialFill = async (host: string): Promise<Record<string, string>> => {
  const query = `protocol=https\nhost=${host}\n\n`;

  return await new Promise<Record<string, string>>((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(new Error('Git is not installed or not in PATH.'));
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git credential fill failed with code ${code}`));
        return;
      }

      const map: Record<string, string> = {};
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const index = line.indexOf('=');
          if (index > 0) {
            const key = line.slice(0, index).trim();
            const value = line.slice(index + 1).trim();
            map[key] = value;
          }
        });

      resolve(map);
    });

    child.stdin.write(query);
    child.stdin.end();
  });
};

const normalizeRequired = (value: string, field: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty`);
  }
  return trimmed;
};

const encryptToken = (token: string) => {
  const raw = token.trim();
  if (!raw) {
    throw new Error('Token cannot be empty');
  }

  if (safeStorage.isEncryptionAvailable()) {
    return `v1:enc:${safeStorage.encryptString(raw).toString('base64')}`;
  }

  return `v1:plain:${Buffer.from(raw, 'utf8').toString('base64')}`;
};

const decodeBase64 = (payload: string) => Buffer.from(payload, 'base64').toString('utf8');

const decryptToken = (payload: string) => {
  try {
    if (!payload) return '';

    if (payload.startsWith('v1:enc:')) {
      const encoded = payload.slice('v1:enc:'.length);
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
      }
      return '';
    }

    if (payload.startsWith('v1:plain:')) {
      return decodeBase64(payload.slice('v1:plain:'.length));
    }

    // backward compatibility
    return decodeBase64(payload);
  } catch {
    return '';
  }
};

const toSummary = (
  account: StoredGitHubAccount,
  defaultAccountId: string | null
): GitHubAccountSummary => ({
  id: account.id,
  displayName: account.displayName,
  username: account.username,
  host: account.host,
  hasToken: Boolean(decryptToken(account.tokenEncrypted)),
  isDefault: defaultAccountId === account.id,
  updatedAt: account.updatedAt,
});

const createDefaultStore = (): GitHubAccountStore => ({
  defaultAccountId: null,
  accounts: [],
});

const saveStore = async (store: GitHubAccountStore) => {
  const storePath = getStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8');
};

const normalizeStore = (store: GitHubAccountStore): GitHubAccountStore => {
  const accountIds = new Set(store.accounts.map((account) => account.id));
  if (store.defaultAccountId && !accountIds.has(store.defaultAccountId)) {
    return {
      ...store,
      defaultAccountId: store.accounts[0]?.id || null,
    };
  }
  if (!store.defaultAccountId && store.accounts.length > 0) {
    return {
      ...store,
      defaultAccountId: store.accounts[0].id,
    };
  }
  return store;
};

const loadStore = async (): Promise<GitHubAccountStore> => {
  const storePath = getStorePath();
  try {
    const raw = await fs.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as GitHubAccountStore;
    if (!Array.isArray(parsed.accounts)) {
      return createDefaultStore();
    }
    return normalizeStore(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultStore();
    }
    throw error;
  }
};

export async function listGitHubAccounts(): Promise<GitHubAccountListResult> {
  const store = await loadStore();
  const accounts = store.accounts
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((account) => toSummary(account, store.defaultAccountId));

  return {
    defaultAccountId: store.defaultAccountId,
    accounts,
  };
}

export async function upsertGitHubAccount(
  payload: GitHubAccountUpsertRequest
): Promise<GitHubAccountSummary> {
  const store = await loadStore();
  const displayName = normalizeRequired(payload.displayName, 'Display name');
  const username = normalizeRequired(payload.username, 'Username');
  const host = normalizeHost(payload.host);
  const now = new Date().toISOString();

  const existingIndex = payload.id
    ? store.accounts.findIndex((account) => account.id === payload.id)
    : store.accounts.findIndex(
        (account) => account.username.toLowerCase() === username.toLowerCase() && account.host === host
      );

  if (existingIndex >= 0) {
    const existing = store.accounts[existingIndex];
    const nextToken = payload.token?.trim()
      ? encryptToken(payload.token)
      : existing.tokenEncrypted;

    store.accounts[existingIndex] = {
      ...existing,
      displayName,
      username,
      host,
      tokenEncrypted: nextToken,
      updatedAt: now,
    };

    if (payload.setAsDefault) {
      store.defaultAccountId = existing.id;
    }

    const normalized = normalizeStore(store);
    await saveStore(normalized);
    return toSummary(normalized.accounts[existingIndex], normalized.defaultAccountId);
  }

  const token = normalizeRequired(payload.token || '', 'Token');
  const id = payload.id || randomUUID();
  const created: StoredGitHubAccount = {
    id,
    displayName,
    username,
    host,
    tokenEncrypted: encryptToken(token),
    createdAt: now,
    updatedAt: now,
  };

  store.accounts.push(created);
  if (!store.defaultAccountId || payload.setAsDefault) {
    store.defaultAccountId = id;
  }

  const normalized = normalizeStore(store);
  await saveStore(normalized);
  const saved = normalized.accounts.find((account) => account.id === id) || created;
  return toSummary(saved, normalized.defaultAccountId);
}

export async function loginGitHubAccountWithBrowser(
  hostInput?: string
): Promise<GitHubAccountBrowserLoginResult> {
  const host = normalizeHost(hostInput);
  const credential = await runGitCredentialFill(host);

  const username = normalizeRequired(credential.username || '', 'Username');
  const token = normalizeRequired(credential.password || '', 'Token');
  const displayName = `${username}@${host}`;

  const before = await listGitHubAccounts();
  const account = await upsertGitHubAccount({
    displayName,
    username,
    host,
    token,
    setAsDefault: before.accounts.length === 0,
  });
  const created =
    !before.accounts.some((item) => item.username === account.username && item.host === account.host);

  return {
    account,
    created,
  };
}

export async function removeGitHubAccount(accountId: string): Promise<void> {
  const targetId = normalizeRequired(accountId, 'Account ID');
  const store = await loadStore();
  const nextAccounts = store.accounts.filter((account) => account.id !== targetId);

  if (nextAccounts.length === store.accounts.length) {
    throw new Error(`GitHub account not found: ${targetId}`);
  }

  const nextStore: GitHubAccountStore = {
    defaultAccountId: store.defaultAccountId === targetId ? null : store.defaultAccountId,
    accounts: nextAccounts,
  };

  const normalized = normalizeStore(nextStore);
  await saveStore(normalized);
}

export async function setDefaultGitHubAccount(accountId: string): Promise<void> {
  const targetId = normalizeRequired(accountId, 'Account ID');
  const store = await loadStore();
  const exists = store.accounts.some((account) => account.id === targetId);
  if (!exists) {
    throw new Error(`GitHub account not found: ${targetId}`);
  }

  store.defaultAccountId = targetId;
  await saveStore(store);
}

export async function getGitHubAccountCredential(
  accountId?: string
): Promise<GitHubAccountCredential | null> {
  const store = await loadStore();

  const targetId = accountId?.trim() || store.defaultAccountId || '';
  if (!targetId) {
    return null;
  }

  const account = store.accounts.find((item) => item.id === targetId);
  if (!account) {
    return null;
  }

  const token = decryptToken(account.tokenEncrypted);
  if (!token) {
    return null;
  }

  return {
    accountId: account.id,
    displayName: account.displayName,
    username: account.username,
    host: account.host,
    token,
  };
}
