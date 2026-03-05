import { useEffect } from 'react';
import { useScannerStore } from '../store';
import { IconButton } from '../components/ui/IconButton';
import './Environment.css';

export function Environment() {
  const { report, scanning, error, startScan } = useScannerStore();

  useEffect(() => {
    if (window.electronAPI) {
      // 自动执行一次扫描
      startScan();
    }
  }, []);

  const handleScan = () => {
    startScan();
  };

  if (scanning) {
    return (
      <div className="environment">
        <div className="loading">Scanning environment...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="environment">
        <div className="error">Error: {error}</div>
        <IconButton className="scan-button" icon="refresh" label="Retry Scan" onClick={handleScan} />
      </div>
    );
  }

  return (
    <div className="environment">
      <div className="environment-header">
        <h1>Environment Scan</h1>
        <IconButton
          className="scan-button"
          onClick={handleScan}
          icon="detect"
          label={scanning ? 'Scanning...' : 'Scan Again'}
          disabled={scanning}
        />
      </div>

      {report && (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <h3>{report.summary.total}</h3>
              <p>Total Tools</p>
            </div>
            <div className="summary-card">
              <h3>{report.summary.healthy}</h3>
              <p>Healthy</p>
            </div>
            <div className="summary-card">
              <h3>{report.summary.warnings}</h3>
              <p>Warnings</p>
            </div>
            <div className="summary-card">
              <h3>{report.summary.errors}</h3>
              <p>Errors</p>
            </div>
          </div>

          <div className="tools-list">
            <h2>Detected Tools</h2>
            {report.detectedTools.length > 0 ? (
              report.detectedTools.map((tool) => (
                <div key={tool.id} className="tool-item">
                  <div className="tool-info">
                    <h3>{tool.name}</h3>
                    <p>
                      Version: {tool.version} • Path: {tool.path}
                    </p>
                  </div>
                  <div className="tool-status">
                    <span
                      className={`status-badge status-${tool.healthStatus}`}
                    >
                      {tool.healthStatus}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">No tools detected</div>
            )}
          </div>

          {report.conflicts && report.conflicts.length > 0 && (
            <div className="tools-list" style={{ marginTop: '1rem' }}>
              <h2>Conflicts</h2>
              {report.conflicts.map((conflict, index) => (
                <div key={index} className="tool-item">
                  <div className="tool-info">
                    <h3>{conflict.type}</h3>
                    <p>{conflict.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!report && !scanning && (
        <div className="empty">No scan results available</div>
      )}
    </div>
  );
}
