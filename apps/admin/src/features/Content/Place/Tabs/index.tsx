import { useNavigate } from '@tanstack/react-router';
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
  /** Each tab is a whole screen with its own header (the list, the builder, the document). */
  children: ReactNode;
  /**
   * The tab shows an entry document: its sticky top bar pulls itself up into the page gutter, so the panel
   * makes room for it under the tabs (the tabs scroll away; only the document's bar sticks).
   */
  document?: boolean;
};

/**
 * Entries · Structure · API, for admins who manage the place's schema. The tabs sit above each tab's own
 * header because every tab is a full screen (the builder and the document bring their own headers). The tab
 * lives in the URL (`?tab=`), so it is bookmarkable and the back button works.
 */
export const Tabs = ({ tab, placeLabel, children, document = false }: TabsProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/content/$modelKey' });
  return (
    <TabsRoot
      value={tab}
      onValueChange={(value) =>
        void navigate({
          search: (previous) => ({ ...previous, tab: value === 'entries' ? undefined : (value as PlaceTab) }),
        })
      }
      className="gap-6"
    >
      <TabsList variant="underline" aria-label={t('place.tabs.label', { place: placeLabel })}>
        {PLACE_TABS.map((key) => (
          <TabsTrigger key={key} value={key}>
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
