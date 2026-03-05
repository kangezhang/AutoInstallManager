import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const rendererStorage = createJSONStorage(() => {
  if (typeof window === 'undefined') {
    return noopStorage;
  }
  return window.localStorage;
});

