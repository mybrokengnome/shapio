import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs as TabsRoot, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/helpers/cn';
import { PLACE_TABS, type PlaceTab } from '../constants';

const TAB_LABEL_KEYS = {
  entries: 'place.tabs.entries',
  structure: 'place.tabs.structure',
  api: 'place.tabs.api',
} as const satisfies Record<PlaceTab, string>;

type TabsProps = {
  tab: PlaceTab;
  placeLabel: string;
  /** The place's key as it appears in the URL (`/content/$modelKey`). */
  modelKey: string;
  /** Each tab is a whole screen with its own header (the list, the builder, the document). */
  children: ReactNode;
  /**
   * The tab shows an entry document: its sticky top bar pulls itself up into the page gutter, so the panel
   * makes room for it under the tabs (the tabs scroll away; only the document's bar sticks).
   */
  document?: boolean;
  /**
   * Shown above one entry of a collection (`/content/$modelKey/$entryId` or `/new`): Entries goes back to
   * the list, and the other tabs open on the place without the entry's search.
   */
  entryPage?: boolean;
};

/**
 * Entries · Structure · API, for admins who manage the place's schema, above the place and above each of a
 * collection's entries. The tabs sit above each tab's own header because every tab is a full screen (the
 * builder and the document bring their own headers). The tab
 * lives in the URL (`?tab=`), so it is bookmarkable and the back button works.
 */
export const Tabs = ({
  tab,
  placeLabel,
  modelKey,
  children,
  document = false,
  entryPage = false,
}: TabsProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/content/$modelKey' });
  const { locale } = useSearch({ strict: false });
  const open = (value: PlaceTab) => {
    const next = value === 'entries' ? undefined : value;
    if (entryPage) {
      // From an entry: the place route itself, keeping only the locale.
      void navigate({ to: '/content/$modelKey', params: { modelKey }, search: { locale, tab: next } });
      return;
    }
    void navigate({ search: (previous) => ({ ...previous, tab: next }) });
  };
  return (
    <TabsRoot value={tab} onValueChange={(value) => open(value as PlaceTab)} className="gap-6">
      <TabsList variant="underline" aria-label={t('place.tabs.label', { place: placeLabel })}>
        {PLACE_TABS.map((key) => (
          <TabsTrigger
            key={key}
            value={key}
            // On an entry page Entries is the selected tab: selecting it again goes back to the list.
            onClick={entryPage && key === tab ? () => open(key) : undefined}
          >
            {t(TAB_LABEL_KEYS[key])}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tab} className={cn('min-w-0', document && 'pt-7')}>
        {children}
      </TabsContent>
    </TabsRoot>
  );
};
