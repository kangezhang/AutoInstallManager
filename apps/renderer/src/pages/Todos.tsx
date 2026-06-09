import { FormEvent, useMemo, useState } from 'react';
import { IconButton } from '../components/ui/IconButton';
import { useI18n } from '../i18n';
import { useTodoStore, type TodoItem, type TodoPriority } from '../store/todos';
import './Todos.css';

type TodoFilter = 'all' | 'active' | 'completed';

interface TodoFormState {
  title: string;
  notes: string;
  priority: TodoPriority;
  dueDate: string;
}

const emptyForm: TodoFormState = {
  title: '',
  notes: '',
  priority: 'medium',
  dueDate: '',
};

const priorityRank: Record<TodoPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const isOverdue = (todo: TodoItem) => {
  if (!todo.dueDate || todo.completed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${todo.dueDate}T00:00:00`).getTime() < today.getTime();
};

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });

export function Todos() {
  const { t } = useI18n();
  const { todos, addTodo, updateTodo, toggleTodo, deleteTodo, clearCompleted } = useTodoStore();
  const [form, setForm] = useState<TodoFormState>(emptyForm);
  const [filter, setFilter] = useState<TodoFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TodoFormState>(emptyForm);

  const stats = useMemo(() => {
    const completed = todos.filter((todo) => todo.completed).length;
    const overdue = todos.filter(isOverdue).length;
    return {
      total: todos.length,
      active: todos.length - completed,
      completed,
      overdue,
    };
  }, [todos]);

  const visibleTodos = useMemo(
    () =>
      todos
        .filter((todo) => {
          if (filter === 'active') return !todo.completed;
          if (filter === 'completed') return todo.completed;
          return true;
        })
        .sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
          if (priorityRank[a.priority] !== priorityRank[b.priority]) {
            return priorityRank[a.priority] - priorityRank[b.priority];
          }
          if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
            return a.dueDate.localeCompare(b.dueDate);
          }
          if (a.dueDate !== b.dueDate) return a.dueDate ? -1 : 1;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [filter, todos]
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    addTodo({
      title: form.title,
      notes: form.notes,
      priority: form.priority,
      dueDate: form.dueDate || null,
    });
    setForm(emptyForm);
  };

  const startEditing = (todo: TodoItem) => {
    setEditingId(todo.id);
    setEditForm({
      title: todo.title,
      notes: todo.notes,
      priority: todo.priority,
      dueDate: todo.dueDate ?? '',
    });
  };

  const saveEditing = (todoId: string) => {
    updateTodo(todoId, {
      title: editForm.title,
      notes: editForm.notes,
      priority: editForm.priority,
      dueDate: editForm.dueDate || null,
    });
    setEditingId(null);
  };

  const filterLabels: Record<TodoFilter, string> = {
    all: t('todos.filter.all'),
    active: t('todos.filter.active'),
    completed: t('todos.filter.completed'),
  };

  return (
    <div className="todos">
      <div className="page-header">
        <div>
          <h1>{t('todos.title')}</h1>
          <p>{t('todos.subtitle')}</p>
        </div>
        {stats.completed > 0 && (
          <button className="todo-clear-btn" type="button" onClick={clearCompleted}>
            {t('todos.clearCompleted')}
          </button>
        )}
      </div>

      <section className="todo-panel">
        <form className="todo-form" onSubmit={handleSubmit}>
          <div className="todo-form-main">
            <label>
              <span>{t('todos.field.title')}</span>
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder={t('todos.placeholder.title')}
                maxLength={120}
              />
            </label>
            <label>
              <span>{t('todos.field.notes')}</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder={t('todos.placeholder.notes')}
                rows={2}
                maxLength={400}
              />
            </label>
          </div>
          <div className="todo-form-meta">
            <label>
              <span>{t('todos.field.priority')}</span>
              <select
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value as TodoPriority })
                }
              >
                <option value="high">{t('todos.priority.high')}</option>
                <option value="medium">{t('todos.priority.medium')}</option>
                <option value="low">{t('todos.priority.low')}</option>
              </select>
            </label>
            <label>
              <span>{t('todos.field.dueDate')}</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
              />
            </label>
            <button className="todo-add-btn" type="submit" disabled={!form.title.trim()}>
              {t('todos.add')}
            </button>
          </div>
        </form>
      </section>

      <section className="todo-summary" aria-label={t('todos.summary')}>
        <div>
          <span>{stats.total}</span>
          <small>{t('todos.stat.total')}</small>
        </div>
        <div>
          <span>{stats.active}</span>
          <small>{t('todos.stat.active')}</small>
        </div>
        <div>
          <span>{stats.completed}</span>
          <small>{t('todos.stat.completed')}</small>
        </div>
        <div className={stats.overdue > 0 ? 'todo-stat-alert' : undefined}>
          <span>{stats.overdue}</span>
          <small>{t('todos.stat.overdue')}</small>
        </div>
      </section>

      <div className="todo-toolbar">
        <div className="todo-filter-tabs">
          {(Object.keys(filterLabels) as TodoFilter[]).map((key) => (
            <button
              className={filter === key ? 'active' : ''}
              key={key}
              type="button"
              onClick={() => setFilter(key)}
            >
              {filterLabels[key]}
            </button>
          ))}
        </div>
      </div>

      <section className="todo-list">
        {visibleTodos.length > 0 ? (
          visibleTodos.map((todo) => {
            const editing = editingId === todo.id;
            const overdue = isOverdue(todo);

            return (
              <article
                className={`todo-item${todo.completed ? ' completed' : ''}${
                  overdue ? ' overdue' : ''
                }`}
                key={todo.id}
              >
                <IconButton
                  className="todo-check"
                  icon="confirm"
                  label={todo.completed ? t('todos.markActive') : t('todos.markComplete')}
                  onClick={() => toggleTodo(todo.id)}
                />

                {editing ? (
                  <div className="todo-edit-grid">
                    <input
                      value={editForm.title}
                      onChange={(event) =>
                        setEditForm({ ...editForm, title: event.target.value })
                      }
                      maxLength={120}
                    />
                    <textarea
                      value={editForm.notes}
                      onChange={(event) =>
                        setEditForm({ ...editForm, notes: event.target.value })
                      }
                      rows={2}
                      maxLength={400}
                    />
                    <div className="todo-edit-meta">
                      <select
                        value={editForm.priority}
                        onChange={(event) =>
                          setEditForm({
                            ...editForm,
                            priority: event.target.value as TodoPriority,
                          })
                        }
                      >
                        <option value="high">{t('todos.priority.high')}</option>
                        <option value="medium">{t('todos.priority.medium')}</option>
                        <option value="low">{t('todos.priority.low')}</option>
                      </select>
                      <input
                        type="date"
                        value={editForm.dueDate}
                        onChange={(event) =>
                          setEditForm({ ...editForm, dueDate: event.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="todo-content">
                    <div className="todo-title-row">
                      <h2>{todo.title}</h2>
                      <span className={`todo-priority priority-${todo.priority}`}>
                        {t(`todos.priority.${todo.priority}`)}
                      </span>
                    </div>
                    {todo.notes && <p>{todo.notes}</p>}
                    <div className="todo-meta">
                      {todo.dueDate && (
                        <span className={overdue ? 'todo-due overdue' : 'todo-due'}>
                          {overdue ? t('todos.overdue') : t('todos.due')}:{' '}
                          {formatDate(todo.dueDate)}
                        </span>
                      )}
                      {todo.completedAt && (
                        <span>
                          {t('todos.completedAt')}: {formatDate(todo.completedAt.slice(0, 10))}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="todo-actions">
                  {editing ? (
                    <>
                      <IconButton
                        className="todo-action-btn"
                        icon="save"
                        label={t('todos.save')}
                        onClick={() => saveEditing(todo.id)}
                        disabled={!editForm.title.trim()}
                      />
                      <IconButton
                        className="todo-action-btn"
                        icon="cancel"
                        label={t('todos.cancel')}
                        onClick={() => setEditingId(null)}
                      />
                    </>
                  ) : (
                    <>
                      <IconButton
                        className="todo-action-btn"
                        icon="form"
                        label={t('todos.edit')}
                        onClick={() => startEditing(todo)}
                      />
                      <IconButton
                        className="todo-action-btn danger"
                        icon="remove"
                        label={t('todos.delete')}
                        onClick={() => deleteTodo(todo.id)}
                      />
                    </>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="todo-empty">
            <h2>{t('todos.empty.title')}</h2>
            <p>{t('todos.empty.description')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
