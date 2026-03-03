import { useMemo } from 'react';
import { useSettingsStore } from '../store/settings';
import { translations, type TranslationKey } from './translations';

export function useI18n() {
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  const t = useMemo(
    () =>
      (key: TranslationKey): string => {
        const localized = translations[language][key];
        return localized ?? translations['en-US'][key];
      },
    [language]
  );

  return { language, setLanguage, t };
}