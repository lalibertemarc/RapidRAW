import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ClipboardCopy, ClipboardPaste, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import Button from '../ui/Button';
import ColorField, { normalizeHexColor, useParsedTextField } from '../ui/ColorField';
import ConfirmModal from './ConfirmModal';
import Dropdown from '../ui/Dropdown';
import Input from '../ui/Input';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useThemeName } from '../../hooks/useActiveTheme';
import {
  CustomTheme,
  deriveThemeColors,
  getAllThemes,
  getContrastRatio,
  getThemeSeed,
  parseThemeColors,
  ThemeColors,
  ThemeSeed,
  ThemeToken,
  THEME_TOKENS,
  toHexColor,
} from '../../utils/themes';

interface ThemeEditorModalProps {
  customThemes: Array<CustomTheme>;
  initialTheme: CustomTheme | null;
  isExisting: boolean;
  onClose(): void;
  onDelete(id: string): void;
  onSave(theme: CustomTheme): void;
}

interface ThemeColorFieldProps {
  label: string;
  onChange(color: string): void;
  value: string;
}

const toHexColors = (colors: ThemeColors) =>
  Object.fromEntries(THEME_TOKENS.map((token) => [token, toHexColor(colors[token])])) as ThemeColors;

const MIN_TEXT_CONTRAST = 4.5;

function ThemeColorField({ label, onChange, value }: ThemeColorFieldProps) {
  const field = useParsedTextField(value, onChange, normalizeHexColor);
  return <ColorField color={value} disabled={false} field={field} label={label} onColorChange={onChange} />;
}

function ContrastBadge({ background, foreground, label }: { background: string; foreground: string; label: string }) {
  const { t } = useTranslation();
  const ratio = getContrastRatio(background, foreground);
  const isLow = ratio < MIN_TEXT_CONTRAST;
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex items-center justify-center w-8 h-6 rounded-sm text-xs font-semibold border border-border-color"
        style={{ backgroundColor: background, color: foreground }}
      >
        {t('modals.themeEditor.sample')}
      </span>
      <Text variant={TextVariants.small} color={isLow ? TextColors.error : TextColors.secondary}>
        {label}: {t('modals.themeEditor.contrastRatio', { ratio: ratio.toFixed(1) })}
      </Text>
      {isLow && <AlertTriangle size={14} className="text-red-400" />}
    </div>
  );
}

export default function ThemeEditorModal({
  customThemes,
  initialTheme,
  isExisting,
  onClose,
  onDelete,
  onSave,
}: ThemeEditorModalProps) {
  const { t } = useTranslation();
  const setThemePreview = useSettingsStore((state) => state.setThemePreview);
  const getThemeName = useThemeName();
  const isOpen = initialTheme !== null;
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [colors, setColors] = useState<ThemeColors | null>(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (initialTheme) {
      setName(initialTheme.name);
      setColors(toHexColors(initialTheme.colors));
      setIsAdvancedOpen(false);
      setIsEditingExisting(isExisting);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 300);
    return () => clearTimeout(timer);
  }, [initialTheme, isExisting]);

  useEffect(() => {
    setThemePreview(isOpen ? colors : null);
  }, [isOpen, colors, setThemePreview]);

  useEffect(() => () => setThemePreview(null), [setThemePreview]);

  const allThemes = useMemo(() => getAllThemes(customThemes), [customThemes]);

  const startFromOptions = useMemo(
    () =>
      allThemes.map((theme) => ({
        value: theme.id,
        label: getThemeName(theme),
      })),
    [allThemes, getThemeName],
  );

  const tokenLabels: Record<ThemeToken, string> = {
    '--app-bg-primary': t('modals.themeEditor.tokens.bgPrimary'),
    '--app-bg-secondary': t('modals.themeEditor.tokens.bgSecondary'),
    '--app-surface': t('modals.themeEditor.tokens.surface'),
    '--app-card-active': t('modals.themeEditor.tokens.cardActive'),
    '--app-button-text': t('modals.themeEditor.tokens.buttonText'),
    '--app-text-primary': t('modals.themeEditor.tokens.textPrimary'),
    '--app-text-secondary': t('modals.themeEditor.tokens.textSecondary'),
    '--app-accent': t('modals.themeEditor.tokens.accent'),
    '--app-border-color': t('modals.themeEditor.tokens.border'),
    '--app-hover-color': t('modals.themeEditor.tokens.hover'),
  };

  const handleStartFrom = (id: string) => {
    const theme = allThemes.find((candidate) => candidate.id === id);
    if (theme) setColors(toHexColors(theme.colors));
  };

  const handleSeedChange = (key: keyof ThemeSeed, value: string) => {
    if (!colors) return;
    setColors(toHexColors(deriveThemeColors({ ...getThemeSeed(colors), [key]: value })));
  };

  const handleTokenChange = (token: ThemeToken, value: string) => {
    setColors((prev) => (prev ? { ...prev, [token]: value } : prev));
  };

  const handleSave = useCallback(() => {
    if (!initialTheme || !colors) return;
    onSave({ id: initialTheme.id, name: name.trim() || t('modals.themeEditor.defaultName'), colors });
  }, [initialTheme, colors, name, onSave, t]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ name, colors }, null, 2));
      toast.success(t('modals.themeEditor.copied'));
    } catch (err) {
      console.error('Failed to copy theme:', err);
    }
  };

  const handlePaste = async () => {
    try {
      const parsed = JSON.parse(await navigator.clipboard.readText());
      const pastedColors = parseThemeColors(parsed?.colors);
      if (!pastedColors) throw new Error('Invalid theme colors');
      setColors(pastedColors);
      if (typeof parsed.name === 'string' && parsed.name.trim()) setName(parsed.name.trim());
    } catch (err) {
      console.error('Failed to paste theme:', err);
      toast.error(t('modals.themeEditor.pasteError'));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || isDeleteConfirmOpen) return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    onClose();
  };

  if (!isMounted || !colors) {
    return null;
  }

  const seed = getThemeSeed(colors);

  const modalContent = (
    <>
      <div
        aria-labelledby="theme-editor-title"
        aria-modal="true"
        className={clsx(
          'fixed inset-0 flex items-center justify-center z-[9999] bg-black/30 backdrop-blur-xs',
          'transition-opacity duration-300 ease-in-out',
          show ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
        role="dialog"
      >
        <div
          className={clsx(
            'bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col text-text-primary',
            'transform transition-all duration-300 ease-out',
            show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4',
          )}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <div className="p-6 pb-4">
            <Text variant={TextVariants.title} id="theme-editor-title">
              {isEditingExisting ? t('modals.themeEditor.titleEdit') : t('modals.themeEditor.titleNew')}
            </Text>
          </div>

          <div className="px-6 overflow-y-auto space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text variant={TextVariants.label} className="mb-2 block">
                  {t('modals.themeEditor.name')}
                </Text>
                <Input
                  autoFocus
                  bgClassName="bg-bg-primary"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  placeholder={t('modals.themeEditor.defaultName')}
                  value={name}
                />
              </div>
              <div>
                <Text variant={TextVariants.label} className="mb-2 block">
                  {t('modals.themeEditor.startFrom')}
                </Text>
                <Dropdown
                  onChange={handleStartFrom}
                  options={startFromOptions}
                  placeholder={t('modals.themeEditor.startFromPlaceholder')}
                  triggerClassName="bg-bg-primary"
                  value={null}
                />
              </div>
            </div>

            <div>
              <Text variant={TextVariants.heading} className="block mb-1">
                {t('modals.themeEditor.basics')}
              </Text>
              <Text variant={TextVariants.small} className="block mb-3">
                {t('modals.themeEditor.basicsDesc')}
              </Text>
              <div className="grid grid-cols-3 gap-3">
                <ThemeColorField
                  label={t('modals.themeEditor.background')}
                  onChange={(value) => handleSeedChange('background', value)}
                  value={seed.background}
                />
                <ThemeColorField
                  label={t('modals.themeEditor.text')}
                  onChange={(value) => handleSeedChange('text', value)}
                  value={seed.text}
                />
                <ThemeColorField
                  label={t('modals.themeEditor.tokens.accent')}
                  onChange={(value) => handleSeedChange('accent', value)}
                  value={seed.accent}
                />
              </div>
            </div>

            <div className="space-y-1">
              <ContrastBadge
                background={colors['--app-bg-primary']}
                foreground={colors['--app-text-primary']}
                label={t('modals.themeEditor.textContrast')}
              />
              <ContrastBadge
                background={colors['--app-accent']}
                foreground={colors['--app-button-text']}
                label={t('modals.themeEditor.buttonContrast')}
              />
            </div>

            <div>
              <button
                className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
                onClick={() => setIsAdvancedOpen((open) => !open)}
              >
                <ChevronDown size={16} className={clsx('transition-transform', !isAdvancedOpen && '-rotate-90')} />
                <Text as="span" variant={TextVariants.heading} color={TextColors.secondary}>
                  {t('modals.themeEditor.advanced')}
                </Text>
              </button>
              {isAdvancedOpen && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {THEME_TOKENS.map((token) => (
                    <ThemeColorField
                      key={token}
                      label={tokenLabels[token]}
                      onChange={(value) => handleTokenChange(token, value)}
                      value={colors[token]}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 p-6 pt-4">
            <div className="flex items-center gap-1">
              <button
                className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors"
                data-tooltip={t('modals.themeEditor.copyJson')}
                onClick={handleCopy}
              >
                <ClipboardCopy size={18} />
              </button>
              <button
                className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors"
                data-tooltip={t('modals.themeEditor.pasteJson')}
                onClick={handlePaste}
              >
                <ClipboardPaste size={18} />
              </button>
              {isEditingExisting && (
                <button
                  className="p-2 rounded-md text-text-secondary hover:text-red-400 hover:bg-bg-primary transition-colors"
                  data-tooltip={t('modals.themeEditor.delete')}
                  onClick={() => setIsDeleteConfirmOpen(true)}
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <Button className="bg-bg-primary text-text-primary shadow-none" onClick={onClose}>
                {t('modals.themeEditor.cancel')}
              </Button>
              <Button onClick={handleSave}>{t('modals.themeEditor.save')}</Button>
            </div>
          </div>
        </div>
      </div>
      <ConfirmModal
        confirmText={t('modals.themeEditor.delete')}
        confirmVariant="destructive"
        isOpen={isDeleteConfirmOpen}
        message={t('modals.themeEditor.deleteMessage', { name })}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => initialTheme && onDelete(initialTheme.id)}
        title={t('modals.themeEditor.deleteTitle')}
      />
    </>
  );

  return createPortal(modalContent, document.body);
}
