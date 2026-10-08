import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveTheme, ThemeGroup, ThemeProps } from '../utils/themes';

const TRANSLATED_GROUPS = [ThemeGroup.Builtin, ThemeGroup.Neutral];

export function useActiveTheme() {
  const { theme, themePreview, customThemes } = useSettingsStore(
    useShallow((state) => ({
      theme: state.theme,
      themePreview: state.themePreview,
      customThemes: state.appSettings?.customThemes,
    })),
  );

  return useMemo(() => resolveTheme(theme, customThemes, themePreview), [theme, customThemes, themePreview]);
}

export function useThemeName() {
  const { t } = useTranslation();
  return useCallback(
    (theme: ThemeProps) => (TRANSLATED_GROUPS.includes(theme.group) ? t(theme.name as ParseKeys) : theme.name),
    [t],
  );
}
