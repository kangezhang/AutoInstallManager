import { useEffect } from 'react';
import { useCatalogStore, useInstallerStore } from '../store';
import './Catalog.css';

export function Catalog() {
  const { tools, loading, error, loadTools } = useCatalogStore();
  const { createTask, startTask } = useInstallerStore();

  useEffect(() => {
    if (window.electronAPI) {
      loadTools();
    }
  }, [loadTools]);

  const handleInstall = async (toolId: string) => {
    try {
      const task = await createTask(toolId, 'latest');
      await startTask(task.id);
    } catch (error) {
      console.error('Failed to install tool:', error);
    }
  };

  if (loading) {
    return (
      <div className="catalog">
        <div className="loading">Loading tools...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="catalog">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="catalog">
      <div className="catalog-header">
        <h1>Tool Catalog</h1>
        <p>Browse and install development tools</p>
      </div>

      <div className="catalog-grid">
        {tools.map((tool) => (
          <div key={tool.id} className="tool-card">
            <h3>{tool.name}</h3>
            <p>{tool.description}</p>

            {tool.tags && tool.tags.length > 0 && (
              <div className="tool-tags">
                {tool.tags.map((tag) => (
                  <span key={tag} className="tool-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="tool-actions">
              <button
                className="btn btn-primary"
                onClick={() => handleInstall(tool.id)}
              >
                Install
              </button>
              <button className="btn btn-secondary">
                Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {tools.length === 0 && !loading && (
        <div className="loading">No tools available</div>
      )}
    </div>
  );
}
