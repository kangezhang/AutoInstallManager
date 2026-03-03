import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n';
import './Sidebar.css';

export function Sidebar() {
  const location = useLocation();
  const { t } = useI18n();

  const isActive = (path: string) => location.pathname === path;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>AIM</h2>
      </div>
      <nav className="sidebar-nav">
        <Link
          to="/dashboard"
          className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
        >
          {t('sidebar.dashboard')}
        </Link>
        <Link
          to="/catalog"
          className={`nav-item ${isActive('/catalog') ? 'active' : ''}`}
        >
          {t('sidebar.catalog')}
        </Link>
        <Link
          to="/tasks"
          className={`nav-item ${isActive('/tasks') ? 'active' : ''}`}
        >
          {t('sidebar.tasks')}
        </Link>
      </nav>
      <div className="sidebar-footer">
        <Link
          to="/settings"
          className={`settings-item ${isActive('/settings') ? 'active' : ''}`}
        >
          {t('sidebar.settings')}
        </Link>
      </div>
    </aside>
  );
}
