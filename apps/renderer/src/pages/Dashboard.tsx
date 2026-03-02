import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScannerStore, useCatalogStore } from '../store';
import type { PlatformInfo } from '@aim/shared';
import './Dashboard.css';

export function Dashboard() {
  const navigate = useNavigate();
  const { report, startScan } = useScannerStore();
  const { tools, loadTools } = useCatalogStore();
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
      <h1>Dashboard</h1>
      <div className="dashboard-grid">
        <section className="dashboard-section">
          <h2>Platform Information</h2>
          {platformInfo ? (
            <div className="info-grid">
              <div className="info-item">
                <label>Operating System</label>
                <value>{platformInfo.os === 'win' ? 'Windows' : 'macOS'}</value>
              </div>
              <div className="info-item">
                <label>Architecture</label>
                <value>{platformInfo.arch}</value>
              </div>
              <div className="info-item">
                <label>OS Version</label>
                <value>{platformInfo.version}</value>
              </div>
              <div className="info-item">
                <label>Admin Rights</label>
                <value>{platformInfo.isAdmin ? 'Yes' : 'No'}</value>
              </div>
            </div>
          ) : (
            <div className="loading">Loading...</div>
          )}
        </section>
        <section className="dashboard-section">
          <h2>Environment Health</h2>
          {report ? (
            <div className="stats-grid">
              <div className="stat-card">
                <h3>{report.summary.total}</h3>
                <p>Total Tools</p>
              </div>
              <div className="stat-card">
                <h3>{report.summary.healthy}</h3>
                <p>Healthy</p>
              </div>
            </div>
          ) : (
            <div className="loading">Scanning...</div>
          )}
        </section>
        <section className="dashboard-section">
          <h2>Available Tools</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <h3>{tools.length}</h3>
              <p>Tools in Catalog</p>
            </div>
          </div>
          <div className="quick-actions">
            <button className="action-btn" onClick={() => navigate('/catalog')}>
              Browse Catalog
            </button>
            <button className="action-btn secondary" onClick={() => navigate('/environment')}>
              View Environment
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
