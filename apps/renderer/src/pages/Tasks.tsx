import { useEffect } from 'react';
import { useInstallerStore } from '../store';
import './Tasks.css';

export function Tasks() {
  const { tasks, loading, error, loadTasks, cancelTask } = useInstallerStore();

  useEffect(() => {
    if (!window.electronAPI) return;

    loadTasks();
    // 定期刷新任务列表
    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  const handleCancel = async (taskId: string) => {
    await cancelTask(taskId);
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="tasks">
        <div className="loading">Loading tasks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tasks">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="tasks">
      <div className="tasks-header">
        <h1>Installation Tasks</h1>
        <p>Monitor and manage installation tasks</p>
      </div>

      <div className="tasks-list">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <div key={task.id} className="task-card">
              <div className="task-header">
                <div className="task-info">
                  <h3>{task.toolName}</h3>
                  <p>Version: {task.version}</p>
                </div>
                <span className={`task-status status-${task.status}`}>
                  {task.status}
                </span>
              </div>

              {task.progress && (
                <div className="task-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${task.progress.percent}%` }}
                    />
                  </div>
                  <div className="progress-text">{task.progress.message}</div>
                </div>
              )}

              {task.error && (
                <div className="error" style={{ textAlign: 'left', padding: '0.5rem 0' }}>
                  Error: {task.error}
                </div>
              )}

              <div className="task-actions">
                {(task.status === 'pending' || task.status === 'downloading') && (
                  <button
                    className="btn btn-danger"
                    onClick={() => handleCancel(task.id)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="empty">No tasks available</div>
        )}
      </div>
    </div>
  );
}
