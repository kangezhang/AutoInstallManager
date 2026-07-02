import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rendererStorage } from './persist-storage';

export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  important: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface TodoState {
  todos: TodoItem[];
  addTodo: (title: string) => void;
  toggleTodo: (id: string) => void;
  toggleImportant: (id: string) => void;
  deleteTodo: (id: string) => void;
  clearCompleted: () => void;
}

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const normalizeTitle = (value: string) => value.trim().replace(/\s+/g, ' ');

const asString = (value: unknown) => (typeof value === 'string' ? value : null);

const normalizePersistedTodos = (value: unknown): TodoItem[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<TodoItem[]>((items, raw) => {
    if (!raw || typeof raw !== 'object') return items;

    const record = raw as Record<string, unknown>;
    const title = normalizeTitle(asString(record.title) ?? '');
    if (!title) return items;

    const now = new Date().toISOString();
    const completed = Boolean(record.completed);

    items.push({
      id: asString(record.id) ?? createId(),
      title,
      completed,
      important: Boolean(record.important),
      createdAt: asString(record.createdAt) ?? now,
      updatedAt: asString(record.updatedAt) ?? now,
      completedAt: completed ? asString(record.completedAt) ?? now : null,
    });

    return items;
  }, []);
};

export const useTodoStore = create<TodoState>()(
  persist(
    (set) => ({
      todos: [],

      addTodo: (input) => {
        const title = normalizeTitle(input);
        if (!title) return;

        const now = new Date().toISOString();
        const todo: TodoItem = {
          id: createId(),
          title,
          completed: false,
          important: false,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };

        set((state) => ({ todos: [todo, ...state.todos] }));
      },

      toggleTodo: (id) => {
        set((state) => ({
          todos: state.todos.map((todo) => {
            if (todo.id !== id) return todo;
            const completed = !todo.completed;
            const now = new Date().toISOString();
            return {
              ...todo,
              completed,
              updatedAt: now,
              completedAt: completed ? now : null,
            };
          }),
        }));
      },

      toggleImportant: (id) => {
        set((state) => ({
          todos: state.todos.map((todo) =>
            todo.id === id
              ? { ...todo, important: !todo.important, updatedAt: new Date().toISOString() }
              : todo
          ),
        }));
      },

      deleteTodo: (id) => {
        set((state) => ({ todos: state.todos.filter((todo) => todo.id !== id) }));
      },

      clearCompleted: () => {
        set((state) => ({ todos: state.todos.filter((todo) => !todo.completed) }));
      },
    }),
    {
      name: 'devstack.todos.store.v1',
      storage: rendererStorage,
      version: 2,
      migrate: (persistedState) => ({
        todos: normalizePersistedTodos(
          (persistedState as Partial<TodoState> | undefined)?.todos
        ),
      }),
      partialize: (state) => ({ todos: state.todos }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        todos: normalizePersistedTodos(
          (persistedState as Partial<TodoState> | undefined)?.todos
        ),
      }),
    }
  )
);
