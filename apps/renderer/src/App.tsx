import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Catalog } from './pages/Catalog';
import { Todos } from './pages/Todos';
import { Settings } from './pages/Settings';
import { Repositories } from './pages/Repositories';
import { RepositoryUpload } from './pages/RepositoryUpload';
import { DualNetBridge } from './pages/DualNetBridge';
import './App.css';

function MainArea() {
  const location = useLocation();
  const isFullBleed = location.pathname.startsWith('/repositories');
  return (
    <main className={`main-content${isFullBleed ? ' main-content-full' : ''}`}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/repositories" element={<Repositories />} />
        <Route path="/repositories/*" element={<Navigate to="/repositories" replace />} />
        <Route path="/repository-upload" element={<RepositoryUpload />} />
        <Route path="/repository-install" element={<Navigate to="/repositories" replace />} />
        <Route path="/environment" element={<Navigate to="/catalog" replace />} />
        <Route path="/tasks" element={<Navigate to="/catalog" replace />} />
        <Route path="/todos" element={<Todos />} />
        <Route path="/dualnet" element={<DualNetBridge />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </main>
  );
}

export function App() {
  return (
    <HashRouter>
      <div className="app-container">
        <Sidebar />
        <MainArea />
      </div>
    </HashRouter>
  );
}
