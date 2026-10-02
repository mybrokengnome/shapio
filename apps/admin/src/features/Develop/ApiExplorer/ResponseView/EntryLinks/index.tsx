import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ResponseEntry } from '../../helpers/entries';

type EntryLinksProps = { entries: readonly ResponseEntry[]; modelKey: string };

/** One row per returned entry with a link to edit it in the admin. */
export const EntryLinks = ({ entries, modelKey }: EntryLinksProps) => {
  const { t } = useTranslation();
  return (
    <ul aria-label={t('develop.api.response.entries')} className="divide-y rounded-lg border">
      {entries.map((entry) => (
        <li key={`${entry.id}:${entry.locale ?? ''}`} className="flex min-w-0 items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{entry.label ?? t('content.untitled')}</p>
            <p className="truncate font-mono text-2xs text-muted-foreground">
              {entry.locale
                ? t('develop.api.response.idLocale', { id: entry.id, locale: entry.locale })
                : entry.id}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link
              to="/content/$modelKey/$entryId"
              params={{ modelKey, entryId: entry.id }}
              search={entry.locale ? { locale: entry.locale } : {}}
              aria-label={t('develop.api.response.editEntryLabel', { entry: entry.label ?? entry.id })}
            >
              <Pencil aria-hidden="true" />
              {t('develop.api.response.editEntry')}
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
};
