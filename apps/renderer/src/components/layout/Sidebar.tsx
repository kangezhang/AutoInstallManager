import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n';
import './Sidebar.css';

/**
 * Grouped navigation: tools workflows are separated from GitHub collaboration
 * to reduce the cognitive load on the previous flat menu. The active path is
 * matched by prefix so deep routes still highlight their parent.
 */

interface NavItem {
  to: string;
  label: string;
  icon: string;
  match?: (path: string) => boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const startsWith = (prefix: string) => (path: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

export function Sidebar() {
  const location = useLocation();
  const { t } = useI18n();

  const groups: NavGroup[] = [
    {
      label: t('sidebar.group.workspace') || 'Workspace',
      items: [
        { to: '/dashboard', label: t('sidebar.dashboard'), icon: 'home' },
        { to: '/catalog', label: t('sidebar.catalog'), icon: 'box' },
        { to: '/todos', label: t('sidebar.todos'), icon: 'check' },
        { to: '/dualnet', label: 'DualNet', icon: 'network' },
      ],
    },
    {
      label: t('sidebar.group.github') || 'GitHub',
      items: [
        {
          to: '/repositories',
          label: t('sidebar.repositories'),
          icon: 'repo',
          match: startsWith('/repositories'),
        },
      ],
    },
  ];

  const isActive = (item: NavItem) => {
    const matcher = item.match ?? ((p) => p === item.to);
    return matcher(location.pathname);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">D</span>
          <div>
            <div className="sidebar-brand-name">DevStack</div>
            <div className="sidebar-brand-tag">Manager</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {groups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-item ${isActive(item) ? 'active' : ''}`}
                data-icon={item.icon}
              >
                <span className="nav-item-dot" aria-hidden="true" />
                <span className="nav-item-label">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <Link
          to="/settings"
          className={`nav-item nav-item-settings ${
            location.pathname === '/settings' ? 'active' : ''
          }`}
        >
          <span className="nav-item-dot" aria-hidden="true" />
          <span className="nav-item-label">{t('sidebar.settings')}</span>
        </Link>
      </div>
    </aside>
  );
}
