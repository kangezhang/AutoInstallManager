import { useCallback, useEffect, useState } from 'react';
import type { GitHubAccountSummary } from '@aim/shared';
import { useI18n } from '../i18n';
import { IconButton } from '../components/ui/IconButton';
import './Settings.css';

export function Settings() {
  const { language, setLanguage, t } = useI18n();

  const [githubAccounts, setGitHubAccounts] = useState<GitHubAccountSummary[]>([]);
  const [githubSelectedId, setGitHubSelectedId] = useState<string>('');
  const [githubLoading, setGitHubLoading] = useState(false);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [githubError, setGitHubError] = useState<string | null>(null);
  const [githubMessage, setGitHubMessage] = useState<string | null>(null);

  const loadGitHubAccounts = useCallback(async (preferredSelectedId?: string) => {
    if (!window.electronAPI?.githubAccount) {
      setGitHubError('Electron API is not available');
      return;
    }

    setGitHubLoading(true);
    setGitHubError(null);
    try {
      const data = await window.electronAPI.githubAccount.list();
      setGitHubAccounts(data.accounts);
      setGitHubSelectedId((current) => {
        const target =
          preferredSelectedId ||
          current ||
          data.defaultAccountId ||
          data.accounts[0]?.id ||
          '';
        return data.accounts.some((account) => account.id === target) ? target : '';
      });
    } catch (error) {
      setGitHubError(error instanceof Error ? error.message : 'Failed to load GitHub accounts');
    } finally {
      setGitHubLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGitHubAccounts().catch((error) => {
      setGitHubError(error instanceof Error ? error.message : 'Failed to load GitHub accounts');
    });
  }, [loadGitHubAccounts]);

  const handleGitHubConnectWithBrowser = async () => {
    if (!window.electronAPI?.githubAccount) return;

    setGitHubBusy(true);
    setGitHubError(null);
    setGitHubMessage(null);
    try {
      const result = await window.electronAPI.githubAccount.loginWithBrowser('github.com');
      setGitHubMessage(`${t('settings.github.message.connected')}: ${result.account.displayName}`);
      await loadGitHubAccounts(result.account.id);
    } catch (error) {
      setGitHubError(error instanceof Error ? error.message : 'Failed to connect GitHub account');
    } finally {
      setGitHubBusy(false);
    }
  };

  const handleGitHubSetDefault = async () => {
    if (!window.electronAPI?.githubAccount || !githubSelectedId) return;

    setGitHubBusy(true);
    setGitHubError(null);
    setGitHubMessage(null);
    try {
      await window.electronAPI.githubAccount.setDefault(githubSelectedId);
      setGitHubMessage(t('settings.github.message.defaultSet'));
      await loadGitHubAccounts(githubSelectedId);
    } catch (error) {
      setGitHubError(error instanceof Error ? error.message : 'Failed to set default GitHub account');
    } finally {
      setGitHubBusy(false);
    }
  };

  const handleGitHubRemove = async () => {
    if (!window.electronAPI?.githubAccount || !githubSelectedId) return;

    const confirmed = window.confirm('Remove selected GitHub account?');
    if (!confirmed) return;

    setGitHubBusy(true);
    setGitHubError(null);
    setGitHubMessage(null);
    try {
      await window.electronAPI.githubAccount.remove(githubSelectedId);
      setGitHubMessage(t('settings.github.message.removed'));
      setGitHubSelectedId('');
      await loadGitHubAccounts();
    } catch (error) {
      setGitHubError(error instanceof Error ? error.message : 'Failed to remove GitHub account');
    } finally {
      setGitHubBusy(false);
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>{t('settings.title')}</h1>
        <p>{t('settings.description')}</p>
      </header>

      <section className="settings-card">
        <h2>{t('settings.languageSection')}</h2>
        <p>{t('settings.languageHint')}</p>

        <div className="settings-language-options">
          <label className="settings-language-option">
            <input
              type="radio"
              name="language"
              value="en-US"
              checked={language === 'en-US'}
              onChange={() => setLanguage('en-US')}
            />
            <span>{t('settings.language.en')}</span>
          </label>

          <label className="settings-language-option">
            <input
              type="radio"
              name="language"
              value="zh-CN"
              checked={language === 'zh-CN'}
              onChange={() => setLanguage('zh-CN')}
            />
            <span>{t('settings.language.zh')}</span>
          </label>
        </div>

        <p className="settings-current-language">
          {t('settings.currentLanguageLabel')}:{' '}
          {language === 'zh-CN' ? t('settings.currentLanguage.zh') : t('settings.currentLanguage.en')}
        </p>
      </section>

      <section className="settings-card settings-card-wide">
        <h2>{t('settings.github.title')}</h2>
        <p>{t('settings.github.description')}</p>
        <p className="settings-current-language">{t('settings.github.authorizeHint')}</p>

        <div className="settings-account-actions">
          <IconButton
            className="settings-btn settings-btn-primary"
            onClick={handleGitHubConnectWithBrowser}
            icon="browse"
            label={t('settings.github.authorizeBrowser')}
            disabled={githubLoading || githubBusy}
          />
          <IconButton
            className="settings-btn settings-btn-secondary"
            onClick={() => loadGitHubAccounts()}
            icon="refresh"
            label={t('settings.github.refresh')}
            disabled={githubLoading || githubBusy}
          />
          <IconButton
            className="settings-btn settings-btn-secondary"
            onClick={handleGitHubSetDefault}
            icon="confirm"
            label={t('settings.github.setDefault')}
            disabled={githubLoading || githubBusy || !githubSelectedId}
          />
          <IconButton
            className="settings-btn settings-btn-secondary"
            onClick={handleGitHubRemove}
            icon="remove"
            label={t('settings.github.remove')}
            disabled={githubLoading || githubBusy || !githubSelectedId}
          />
        </div>

        {githubLoading && <p className="settings-account-loading">{t('settings.github.loading')}</p>}
        {githubError && (
          <p className="settings-account-error">
            {t('settings.github.errorPrefix')}: {githubError}
          </p>
        )}
        {githubMessage && <p className="settings-account-success">{githubMessage}</p>}

        {!githubLoading && githubAccounts.length === 0 && (
          <p className="settings-account-empty">{t('settings.github.empty')}</p>
        )}

        {!githubLoading && githubAccounts.length > 0 && (
          <div className="settings-account-list">
            {githubAccounts.map((account) => (
              <label className="settings-account-item" key={account.id}>
                <input
                  type="radio"
                  name="github-account"
                  checked={githubSelectedId === account.id}
                  onChange={() => setGitHubSelectedId(account.id)}
                  disabled={githubBusy}
                />
                <div className="settings-account-content">
                  <div className="settings-account-head">
                    <strong>{account.displayName}</strong>
                    <span className={`settings-account-badge ${account.isDefault ? 'active' : 'inactive'}`}>
                      {account.isDefault ? t('settings.github.default') : t('settings.github.notDefault')}
                    </span>
                  </div>
                  <div className="settings-account-path">
                    <span>{t('settings.github.username')}:</span>
                    <code>{account.username}</code>
                  </div>
                  <div className="settings-account-path">
                    <span>{t('settings.github.host')}:</span>
                    <code>{account.host}</code>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
