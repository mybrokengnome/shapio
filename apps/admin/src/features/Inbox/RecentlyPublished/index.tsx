import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Panel } from '@/components/Panel';
import { EntryRow } from '../EntryRow';
import { entryLink } from '../helpers/entryLink';
import { useRecentlyPublished } from '../hooks/useRecentlyPublished';

const CHANGE_KEYS = { published: 'inbox.wentLive', updated: 'inbox.liveUpdated' } as const;

/** What went live lately, across every place the admin can read. */
export const RecentlyPublished = () => {
  const { t } = useTranslation();
  const { items, isPending, error } = useRecentlyPublished();
  return (
    <Panel title={t('inbox.recentlyPublished')} flush>
      {error ? (
        <ErrorState error={error} />
      ) : isPending ? (
        <LoadingState rows={3} className="p-5" />
      ) : items.length === 0 ? (
        <EmptyState
          compact
          icon={Send}
          title={t('inbox.nothingPublished')}
          description={t('inbox.nothingPublishedDescription')}
        />
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <EntryRow
              key={`${item.modelKey}:${item.id}`}
              title={item.title}
              meta={t(CHANGE_KEYS[item.change], { place: item.modelLabel })}
              link={entryLink(item.modelKey, item.id, item.kind)}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
};
