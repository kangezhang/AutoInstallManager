import { useEffect, useMemo, useState } from 'react';
import type { InstallTask } from '@aim/shared';
import { useInstallerStore } from '../store';
import { useI18n } from '../i18n';
import { IconButton } from '../components/ui/IconButton';
import './Tasks.css';

const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const buildTaskConsoleText = (task: InstallTask) => {
  const lines: string[] = [];
  lines.push(`Task ID: ${task.id}`);
  lines.push(`Tool: ${task.toolName} (${task.toolId})`);
  lines.push(`Type: ${task.type}`);
  lines.push(`Status: ${task.status}`);
  lines.push(`Version: ${task.version}`);
  lines.push(`Created: ${task.createdAt}`);
  if (task.startedAt) lines.push(`Started: ${task.startedAt}`);
  if (task.completedAt) lines.push(`Completed: ${task.completedAt}`);
  if (task.installedPath) lines.push(`Installed Path: ${task.installedPath}`);
  lines.push('');
  lines.push('--- Logs ---');

  if (task.logs && task.logs.length > 0) {
    task.logs.forEach((entry) => {
      lines.push(`[${formatTimestamp(entry.timestamp)}] [${entry.level.toUpperCase()}] ${entry.message}`);
    });
  } else {
    lines.push(
      `[${formatTimestamp(task.createdAt)}] [INFO] ${task.progress?.message || 'No progress message'}`
    );
    if (task.error) {
      lines.push(`[${formatTimestamp(task.completedAt || task.createdAt)}] [ERROR] ${task.error}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

export function Tasks() {
  const { tasks, loading, error, loadTasks, cancelTask, rollbackTool, uninstallTool } =
    useInstallerStore();
  const { t } = useI18n();
  const [consoleTaskId, setConsoleTaskId] = useState<string | null>(null);
  const consoleTask = useMemo(
    () => tasks.find((task) => task.id === consoleTaskId) ?? null,
    [tasks, consoleTaskId]
  );

  const consoleOutput = useMemo(
    () => (consoleTask ? buildTaskConsoleText(consoleTask) : ''),
    [consoleTask]
  );

  useEffect(() => {
    if (!window.electronAPI) return;

    loadTasks();
    // 定期刷新任务列表
    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  useEffect(() => {
    if (!consoleTask) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConsoleTaskId(null);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [consoleTask]);

  const handleCancel = async (taskId: string) => {
    await cancelTask(taskId);
  };

  const handleRollback = async (toolId: string) => {
    await rollbackTool(toolId);
  };

  const handleUninstall = async (toolId: string) => {
    await uninstallTool(toolId);
  };

  const handleOpenConsole = (task: InstallTask) => {
    setConsoleTaskId(task.id);
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="tasks">
        <div className="loading">{t('tasks.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tasks">
        <div className="error">
          {t('tasks.errorPrefix')}: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="tasks">
      <div className="tasks-header">
        <h1>{t('tasks.title')}</h1>
        <p>{t('tasks.subtitle')}</p>
      </div>

      <div className="tasks-list">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <div key={task.id} className="task-card">
              <div className="task-header">
                <div className="task-info">
                  <h3>{task.toolName}</h3>
                  <p>
                    {t('tasks.version')}: {task.version}
                  </p>
                </div>
                <div className="task-header-right">
                  {task.status === 'failed' && (
                    <IconButton
                      className="btn btn-console"
                      onClick={() => handleOpenConsole(task)}
                      icon="console"
                      label={t('tasks.consoleOpen')}
                    />
                  )}
                  <span className={`task-status status-${task.status}`}>
                    {task.status}
                  </span>
                </div>
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
                  {t('tasks.errorPrefix')}: {task.error}
                </div>
              )}

              <div className="task-actions">
                {(task.status === 'pending' || task.status === 'downloading') && (
                  <IconButton
                    className="btn btn-danger"
                    onClick={() => handleCancel(task.id)}
                    icon="cancel"
                    label={t('tasks.cancel')}
                  />
                )}
                {task.status === 'installed' && task.rollbackAvailable && (
                  <IconButton
                    className="btn btn-secondary"
                    onClick={() => handleRollback(task.toolId)}
                    icon="rollback"
                    label={t('tasks.rollback')}
                  />
                )}
                {(task.status === 'installed' || task.status === 'rolled-back') && (
                  <IconButton
                    className="btn btn-danger"
                    onClick={() => handleUninstall(task.toolId)}
                    icon="uninstall"
                    label={t('tasks.uninstall')}
                  />
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="empty">{t('tasks.empty')}</div>
        )}
      </div>

      {consoleTask && (
        <div className="task-console-backdrop" onClick={() => setConsoleTaskId(null)}>
          <div className="task-console-modal" onClick={(event) => event.stopPropagation()}>
            <div className="task-console-header">
              <h2>{t('tasks.console')}</h2>
              <IconButton
                className="task-console-close"
                onClick={() => setConsoleTaskId(null)}
                aria-label="Close task console"
                icon="close"
                label={t('tasks.close')}
              />
            </div>
            <div className="task-console-meta">
              {consoleTask.toolName} ({consoleTask.id})
            </div>
            <pre className="task-console-content">{consoleOutput}</pre>
            <div className="task-console-actions">
              <IconButton
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard
                    .writeText(consoleOutput)
                    .catch((copyError) => console.error('Failed to copy task console:', copyError));
                }}
                icon="copy"
                label={t('tasks.copy')}
              />
              <IconButton
                className="btn btn-primary"
                onClick={() => setConsoleTaskId(null)}
                icon="close"
                label={t('tasks.close')}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
