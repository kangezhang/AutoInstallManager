import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rendererStorage } from './persist-storage';

export type TodoPriority = 'low' | 'medium' | 'high';

export interface TodoItem {
  id: string;
  title: string;
  notes: string;
  priority: TodoPriority;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface CreateTodoInput {
  title: string;
  notes?: string;
  priority?: TodoPriority;
  dueDate?: string | null;
}

interface TodoState {
  todos: TodoItem[];
  addTodo: (input: CreateTodoInput) => void;
  updateTodo: (
    id: string,
    patch: Partial<Pick<TodoItem, 'title' | 'notes' | 'priority' | 'dueDate'>>
  ) => void;
  toggleTodo: (id: string) => void;
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

export const useTodoStore = create<TodoState>()(
  persist(
    (set) => ({
      todos: [],

      addTodo: (input) => {
        const title = normalizeTitle(input.title);
        if (!title) return;

        const now = new Date().toISOString();
        const todo: TodoItem = {
          id: createId(),
          title,
          notes: input.notes?.trim() ?? '',
          priority: input.priority ?? 'medium',
          dueDate: input.dueDate || null,
          completed: false,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };

        set((state) => ({ todos: [todo, ...state.todos] }));
      },

      updateTodo: (id, patch) => {
        set((state) => ({
          todos: state.todos.map((todo) => {
            if (todo.id !== id) return todo;

            const nextTitle =
              patch.title === undefined ? todo.title : normalizeTitle(patch.title);
            if (!nextTitle) return todo;

            return {
              ...todo,
              ...patch,
              title: nextTitle,
              notes: patch.notes === undefined ? todo.notes : patch.notes.trim(),
              dueDate: patch.dueDate === undefined ? todo.dueDate : patch.dueDate || null,
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
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
      partialize: (state) => ({ todos: state.todos }),
    }
  )
);
