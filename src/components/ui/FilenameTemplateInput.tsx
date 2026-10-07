import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Braces } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { FILENAME_TOKEN_GROUPS } from './ExportImportProperties';
import Text from './Text';
import { TextColors, TextVariants } from '../../types/typography';

interface FilenameTemplateInputProps {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  showTokens?: boolean;
  includeExportTokens?: boolean;
  autoFocus?: boolean;
  inputClassName?: string;
  onKeyDown?(e: React.KeyboardEvent): void;
}

export default function FilenameTemplateInput({
  value,
  onChange,
  disabled = false,
  showTokens = true,
  includeExportTokens = false,
  autoFocus = false,
  inputClassName = 'bg-surface',
  onKeyDown,
}: FilenameTemplateInputProps) {
  const { t } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const insertToken = (token: string) => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    onChange(input.value.substring(0, start) + token + input.value.substring(end));
    setIsMenuOpen(false);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const groups = FILENAME_TOKEN_GROUPS.filter((group) => includeExportTokens || !('exportOnly' in group));

  return (
    <div
      className="relative"
      ref={containerRef}
      onKeyDown={(e) => {
        if (isMenuOpen && e.key === 'Escape') {
          e.stopPropagation();
          setIsMenuOpen(false);
        }
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          className={clsx(
            'w-full min-w-0 border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent',
            inputClassName,
          )}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          ref={inputRef}
          type="text"
          value={value}
        />
        {showTokens && (
          <button
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            className={clsx(
              'shrink-0 px-2 rounded-md transition-colors disabled:opacity-50',
              isMenuOpen ? 'bg-card-active' : 'bg-surface hover:bg-card-active',
            )}
            data-tooltip={t('export.naming.insertToken')}
            disabled={disabled}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            type="button"
          >
            <Braces size={16} className="text-text-secondary" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="absolute right-0 mt-2 w-full origin-top-right z-20"
            exit={{ opacity: 0, scale: 0.95 }}
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
          >
            <div
              className="bg-surface/95 backdrop-blur-md rounded-lg shadow-xl p-2 max-h-80 overflow-y-auto"
              role="menu"
            >
              {groups.map((group) => (
                <div key={group.id} className="mb-2 last:mb-0">
                  <Text variant={TextVariants.small} color={TextColors.secondary} className="px-2 py-1 uppercase">
                    {t(`export.naming.groups.${group.id}`)}
                  </Text>
                  {group.tokens.map(({ token, key }) => (
                    <button
                      className="w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between gap-3 hover:bg-bg-primary transition-colors duration-150"
                      key={token}
                      onClick={() => insertToken(token)}
                      role="menuitem"
                      type="button"
                    >
                      <Text as="span" color={TextColors.primary} className="font-mono text-xs shrink-0">
                        {token}
                      </Text>
                      <Text as="span" variant={TextVariants.small} color={TextColors.secondary} className="text-right">
                        {t(`export.naming.tokens.${key}`)}
                      </Text>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
