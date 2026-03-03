import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScannerStore, useCatalogStore } from '../store';
import { useI18n } from '../i18n';
import type { PlatformInfo } from '@aim/shared';
import './Dashboard.css';

export function Dashboard() {
  const navigate = useNavigate();
  const { report, startScan } = useScannerStore();
  const { tools, loadTools } = useCatalogStore();
  const { t } = useI18n();
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.platform.getInfo().then(setPlatformInfo);
      loadTools();
      startScan();
    }
  }, []);

  return (
    <div className="dashboard">
      <h1>{t('dashboard.title')}</h1>
      <div className="dashboard-grid">
        <section className="dashboard-section">
          <h2>{t('dashboard.platformInformation')}</h2>
          {platformInfo ? (
            <div className="info-grid">
              <div className="info-item">
                <label>{t('dashboard.operatingSystem')}</label>
                <value>{platformInfo.os === 'win' ? 'Windows' : 'macOS'}</value>
              </div>
              <div className="info-item">
                <label>{t('dashboard.architecture')}</label>
                <value>{platformInfo.arch}</value>
              </div>
              <div className="info-item">
                <label>{t('dashboard.osVersion')}</label>
                <value>{platformInfo.version}</value>
              </div>
              <div className="info-item">
                <label>{t('dashboard.adminRights')}</label>
                <value>{platformInfo.isAdmin ? t('dashboard.admin.yes') : t('dashboard.admin.no')}</value>
              </div>
            </div>
          ) : (
            <div className="loading">{t('dashboard.loading')}</div>
          )}
        </section>
        <section className="dashboard-section">
          <h2>{t('dashboard.environmentHealth')}</h2>
          {report ? (
            <div className="stats-grid">
              <div className="stat-card">
                <h3>{report.summary.total}</h3>
                <p>{t('dashboard.totalTools')}</p>
              </div>
              <div className="stat-card">
                <h3>{report.summary.healthy}</h3>
                <p>{t('dashboard.healthy')}</p>
              </div>
            </div>
          ) : (
            <div className="loading">{t('dashboard.scanning')}</div>
          )}
        </section>
        <section className="dashboard-section">
          <h2>{t('dashboard.availableTools')}</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <h3>{tools.length}</h3>
              <p>{t('dashboard.toolsInCatalog')}</p>
            </div>
          </div>
          <div className="quick-actions">
            <button className="action-btn" onClick={() => navigate('/catalog')}>
              {t('dashboard.browseCatalog')}
            </button>
            <button className="action-btn secondary" onClick={() => navigate('/catalog')}>
              {t('dashboard.refreshToolStatus')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
