import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Catalog } from './pages/Catalog';
import { Tasks } from './pages/Tasks';
import { Settings } from './pages/Settings';
import './App.css';

export function App() {
  return (
    <HashRouter>
      <div className="app-container">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/repositories/*" element={<Navigate to="/catalog" replace />} />
            <Route path="/environment" element={<Navigate to="/catalog" replace />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
