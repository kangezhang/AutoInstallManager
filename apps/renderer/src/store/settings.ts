import { create } from 'zustand';
import type { Locale } from '../i18n/translations';

interface SettingsState {
  language: Locale;
  setLanguage: (language: Locale) => void;
}

const LANGUAGE_STORAGE_KEY = 'aim.language';

const normalizeLanguage = (value: string | null | undefined): Locale | null => {
  if (value === 'en-US' || value === 'zh-CN') {
    return value;
  }
  return null;
};

const detectBrowserLanguage = (): Locale => {
  if (typeof navigator === 'undefined') {
    return 'en-US';
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
};

const getInitialLanguage = (): Locale => {
  if (typeof window === 'undefined') {
    return 'en-US';
  }

  const stored = normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  return stored ?? detectBrowserLanguage();
};

const syncDocumentLanguage = (language: Locale) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
};

const initialLanguage = getInitialLanguage();
syncDocumentLanguage(initialLanguage);

export const useSettingsStore = create<SettingsState>((set) => ({
  language: initialLanguage,
  setLanguage: (language) => {
    syncDocumentLanguage(language);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
    set({ language });
  },
}));