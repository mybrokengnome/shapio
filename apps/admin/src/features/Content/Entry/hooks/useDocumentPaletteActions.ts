import type { AdminEntry, Locale } from '@shapio/client';
import { Languages, PanelRight, Send } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePaletteActions } from '@/components/CommandPalette/hooks/usePaletteActions';
import type { PaletteItem } from '@/components/CommandPalette/types';

type DocumentPaletteOptions = {
  onPublish: (() => void) | undefined;
  onOpenSettings: () => void;
  /** Locales of a localized entry, with "Start French" for the ones it doesn't have yet. */
  locales: readonly Locale[];
  entry: AdminEntry | null;
  onLocaleChange: ((code: string) => void) | undefined;
};

/** The document's actions in the ⌘K palette: Publish, Settings, and switching or starting a locale. */
export const useDocumentPaletteActions = ({
  onPublish,
  onOpenSettings,
  locales,
  entry,
  onLocaleChange,
}: DocumentPaletteOptions) => {
  const { t } = useTranslation();
  // The latest handlers, so the registered actions change only when what they offer changes.
  const latest = useRef({ onPublish, onOpenSettings, onLocaleChange });
  useEffect(() => {
    latest.current = { onPublish, onOpenSettings, onLocaleChange };
  });
  const canPublish = onPublish !== undefined;
  const canSwitch = onLocaleChange !== undefined;
  const actions = useMemo<PaletteItem[]>(
    () => [
      ...(canPublish
        ? [
            {
              id: 'publish',
              label: t('content.actions.publish'),
              icon: Send,
              hint: '⌘⇧P',
              run: () => latest.current.onPublish?.(),
            },
          ]
        : []),
      {
        id: 'settings',
        label: t('entry.settings.open'),
        icon: PanelRight,
        hint: '⌘/',
        run: () => latest.current.onOpenSettings(),
      },
      ...(canSwitch && entry
        ? locales.map((locale) => ({
            id: `locale-${locale.code}`,
            label: entry.locales.some((state) => state.locale === locale.code)
              ? t('entry.palette.switchLocale', { locale: locale.label })
              : t('entry.settings.startLocale', { locale: locale.label }),
            icon: Languages,
            run: () => latest.current.onLocaleChange?.(locale.code),
          }))
        : []),
    ],
    [t, canPublish, canSwitch, locales, entry],
  );
  usePaletteActions(actions);
};
