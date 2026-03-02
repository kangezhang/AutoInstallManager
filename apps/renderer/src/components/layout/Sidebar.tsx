import { Link, useLocation } from 'react-router-dom';
import './Sidebar.css';

export function Sidebar() {
  const location = useLocation();

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
          Dashboard
        </Link>
        <Link
          to="/catalog"
          className={`nav-item ${isActive('/catalog') ? 'active' : ''}`}
        >
          Catalog
        </Link>
        <Link
          to="/tasks"
          className={`nav-item ${isActive('/tasks') ? 'active' : ''}`}
        >
          Tasks
        </Link>
      </nav>
    </aside>
  );
}
