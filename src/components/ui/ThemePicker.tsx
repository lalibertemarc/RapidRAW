import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Palette, Pencil, Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import clsx from 'clsx';
import Text from './Text';
import { TextVariants } from '../../types/typography';
import ThemeEditorModal from '../modals/ThemeEditorModal';
import { AppSettings } from './AppProperties';
import { useActiveTheme, useThemeName } from '../../hooks/useActiveTheme';
import { useCollapsibleHeight } from '../../hooks/useCollapsibleHeight';
import {
  CustomTheme,
  DEFAULT_THEME_ID,
  getAllThemes,
  ThemeColors,
  ThemeGroup,
  THEME_GROUP_ORDER,
} from '../../utils/themes';

interface ThemePickerProps {
  appSettings: AppSettings;
  onSettingsChange(settings: AppSettings): void;
}

interface EditorState {
  isExisting: boolean;
  theme: CustomTheme;
}

function ThemeSwatch({ className = 'h-14 w-full', colors }: { className?: string; colors: ThemeColors }) {
  return (
    <div className={clsx('flex', className)} style={{ backgroundColor: colors['--app-bg-primary'] }}>
      <div className="w-1/4 h-full" style={{ backgroundColor: colors['--app-bg-secondary'] }} />
      <div className="flex-1 flex flex-col justify-center gap-1.5 px-2">
        <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: colors['--app-text-primary'] }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: colors['--app-text-secondary'] }} />
        <div className="h-2.5 w-8 rounded-full" style={{ backgroundColor: colors['--app-accent'] }} />
      </div>
    </div>
  );
}

export default function ThemePicker({ appSettings, onSettingsChange }: ThemePickerProps) {
  const { t } = useTranslation();
  const { colors: activeColors } = useActiveTheme();
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { contentRef, wrapperRef } = useCollapsibleHeight(isExpanded);

  const customThemes = useMemo(() => appSettings.customThemes ?? [], [appSettings.customThemes]);
  const selectedId = appSettings.theme || DEFAULT_THEME_ID;

  const allThemes = useMemo(() => getAllThemes(customThemes), [customThemes]);
  const selectedTheme =
    allThemes.find((theme) => theme.id === selectedId) ?? allThemes.find((theme) => theme.id === DEFAULT_THEME_ID);

  const groups = useMemo(
    () =>
      THEME_GROUP_ORDER.map((group) => ({
        group,
        themes: allThemes.filter((theme) => theme.group === group),
      })).filter(({ group, themes }) => themes.length > 0 || group === ThemeGroup.Custom),
    [allThemes],
  );

  const groupLabels: Record<ThemeGroup, string> = {
    [ThemeGroup.Builtin]: t('settings.themes.groups.builtin'),
    [ThemeGroup.Neutral]: t('settings.themes.groups.neutral'),
    [ThemeGroup.VsCode]: t('settings.themes.groups.vscode'),
    [ThemeGroup.Community]: t('settings.themes.groups.community'),
    [ThemeGroup.Custom]: t('settings.themes.groups.custom'),
  };

  const getThemeName = useThemeName();
  const openNewTheme = (colors: ThemeColors, name: string) =>
    setEditorState({ isExisting: false, theme: { id: `custom-${uuidv4()}`, name, colors } });

  const handleSave = (theme: CustomTheme) => {
    const isExisting = customThemes.some((custom) => custom.id === theme.id);
    const nextThemes = isExisting
      ? customThemes.map((custom) => (custom.id === theme.id ? theme : custom))
      : [...customThemes, theme];
    onSettingsChange({ ...appSettings, customThemes: nextThemes, theme: theme.id });
    setEditorState(null);
  };

  const handleDelete = (id: string) => {
    onSettingsChange({
      ...appSettings,
      customThemes: customThemes.filter((custom) => custom.id !== id),
      theme: selectedId === id ? DEFAULT_THEME_ID : selectedId,
    });
    setEditorState(null);
  };

  return (
    <div>
      <button
        aria-expanded={isExpanded}
        className="flex items-center gap-3 w-full p-2 rounded-lg border border-border-color bg-bg-primary text-left hover:border-text-secondary/50 transition-colors"
        onClick={() => setIsExpanded((expanded) => !expanded)}
      >
        {selectedTheme && (
          <ThemeSwatch className="h-10 w-20 shrink-0 rounded-md overflow-hidden" colors={selectedTheme.colors} />
        )}
        <Text as="span" className="flex-1 truncate">
          {selectedTheme && getThemeName(selectedTheme)}
        </Text>
        <ChevronDown
          size={18}
          className={clsx('text-text-secondary transition-transform duration-300', isExpanded && 'rotate-180')}
        />
      </button>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-300 ease-in-out">
        <div ref={contentRef} className="space-y-4 px-1 pt-4 pb-1">
          {groups.map(({ group, themes }) => (
            <div key={group}>
              <Text variant={TextVariants.label} className="block mb-2">
                {groupLabels[group]}
              </Text>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
                {themes.map((theme) => {
                  const isCustom = theme.group === ThemeGroup.Custom;
                  const name = getThemeName(theme);
                  return (
                    <div className="group relative" key={theme.id}>
                      <button
                        aria-pressed={selectedId === theme.id}
                        className={clsx(
                          'w-full rounded-lg overflow-hidden border border-border-color text-left transition-shadow',
                          selectedId === theme.id ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-text-secondary/40',
                        )}
                        onClick={() => onSettingsChange({ ...appSettings, theme: theme.id })}
                      >
                        <ThemeSwatch colors={theme.colors} />
                        <div className="px-2 py-1.5 bg-bg-primary">
                          <Text variant={TextVariants.small} className="block truncate">
                            {name}
                          </Text>
                        </div>
                      </button>
                      <button
                        className="absolute top-1 right-1 p-1 rounded-md bg-bg-primary/80 text-text-secondary hover:text-text-primary opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        data-tooltip={isCustom ? t('settings.themes.edit') : t('settings.themes.customize')}
                        onClick={() =>
                          isCustom
                            ? setEditorState({
                                isExisting: true,
                                theme: customThemes.find((custom) => custom.id === theme.id) as CustomTheme,
                              })
                            : openNewTheme(theme.colors, t('settings.themes.copyName', { name }))
                        }
                      >
                        {isCustom ? <Pencil size={14} /> : <Palette size={14} />}
                      </button>
                    </div>
                  );
                })}
                {group === ThemeGroup.Custom && (
                  <button
                    className="flex flex-col items-center justify-center gap-1 min-h-[5.5rem] rounded-lg border border-dashed border-text-secondary/50 text-text-secondary hover:text-text-primary hover:border-text-primary transition-colors"
                    onClick={() => openNewTheme(activeColors, t('modals.themeEditor.defaultName'))}
                  >
                    <Plus size={18} />
                    <span className="text-xs">{t('settings.themes.newTheme')}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ThemeEditorModal
        customThemes={customThemes}
        initialTheme={editorState?.theme ?? null}
        isExisting={editorState?.isExisting ?? false}
        onClose={() => setEditorState(null)}
        onDelete={handleDelete}
        onSave={handleSave}
      />
    </div>
  );
}
