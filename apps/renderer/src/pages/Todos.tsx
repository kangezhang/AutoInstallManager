import { FormEvent, useMemo, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { IconButton } from '../components/ui/IconButton';
import { useI18n } from '../i18n';
import { useTodoStore, type TodoItem } from '../store/todos';
import './Todos.css';

const sortOpenTodos = (a: TodoItem, b: TodoItem) => {
  if (a.important !== b.important) return a.important ? -1 : 1;
  return b.createdAt.localeCompare(a.createdAt);
};

export function Todos() {
  const { t } = useI18n();
  const { todos, addTodo, toggleTodo, toggleImportant, clearCompleted } = useTodoStore();
  const [title, setTitle] = useState('');
  const [completedOpen, setCompletedOpen] = useState(true);

  const openTodos = useMemo(
    () => todos.filter((todo) => !todo.completed).sort(sortOpenTodos),
    [todos]
  );

  const completedTodos = useMemo(
    () =>
      todos
        .filter((todo) => todo.completed)
        .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)),
    [todos]
  );

  const submitTodo = (event: FormEvent) => {
    event.preventDefault();
    addTodo(title);
    setTitle('');
  };

  const refreshTodos = () => {
    void useTodoStore.persist.rehydrate();
  };

  const renderTodo = (todo: TodoItem) => (
    <article className={`todo-row${todo.completed ? ' completed' : ''}`} key={todo.id}>
      <IconButton
        className="todo-toggle"
        icon="confirm"
        label={todo.completed ? t('todos.markActive') : t('todos.markComplete')}
        onClick={() => toggleTodo(todo.id)}
      />
      <span className="todo-row-title">{todo.title}</span>
      <IconButton
        className={`todo-important${todo.important ? ' active' : ''}`}
        icon="star"
        label={todo.important ? t('todos.unmarkImportant') : t('todos.markImportant')}
        onClick={() => toggleImportant(todo.id)}
      />
    </article>
  );

  return (
    <div className="todos">
      <header className="todo-header">
        <div className="todo-heading">
          <Icon name="home" size={28} />
          <h1>{t('todos.title')}</h1>
        </div>
        <div className="todo-header-actions">
          <IconButton
            className="todo-header-btn"
            icon="refresh"
            label={t('todos.refresh')}
            onClick={refreshTodos}
          />
          <IconButton
            className="todo-header-btn"
            icon="more"
            label={t('todos.clearCompleted')}
            onClick={clearCompleted}
            disabled={completedTodos.length === 0}
          />
        </div>
      </header>

      <main className="todo-board" aria-label={t('todos.summary')}>
        <section className="todo-open-list">
          {openTodos.length > 0 ? (
            openTodos.map(renderTodo)
          ) : (
            <div className="todo-empty">
              <span>{t('todos.empty.title')}</span>
            </div>
          )}
        </section>

        {completedTodos.length > 0 && (
          <section className="todo-completed">
            <button
              className="todo-completed-toggle"
              type="button"
              onClick={() => setCompletedOpen((value) => !value)}
              aria-expanded={completedOpen}
            >
              <Icon name="chevron" size={14} />
              <span>
                {t('todos.completedGroup')} {completedTodos.length}
              </span>
            </button>
            {completedOpen && (
              <div className="todo-completed-list">{completedTodos.map(renderTodo)}</div>
            )}
          </section>
        )}
      </main>

      <form className="todo-add-bar" onSubmit={submitTodo}>
        <IconButton
          className="todo-add-icon"
          icon="add"
          label={t('todos.add')}
          type="submit"
          disabled={!title.trim()}
        />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('todos.placeholder.title')}
          maxLength={120}
        />
      </form>
    </div>
  );
}
