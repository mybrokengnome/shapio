import { getRouteApi } from '@tanstack/react-router';
import { Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGraphqlPlaygroundAvailable } from '@/api/apiDocs';
import { EmptyState } from '@/components/EmptyState';
import { InfoHint } from '@/components/InfoHint';
import { LoadingState } from '@/components/LoadingState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { usePlaygroundUrl } from './hooks/usePlaygroundUrl';

const route = getRouteApi('/app/develop/graphql');

/**
 * GraphQL: the vendored GraphiQL (same origin, the admin session, introspection and docs) for this page's
 * site, filling the screen under the header. Opening another site is a full navigation, so the frame always
 * shows the shell's site.
 */
export const Graphql = () => {
  const { t } = useTranslation();
  const { query } = route.useSearch();
  const src = usePlaygroundUrl(query);
  const available = useGraphqlPlaygroundAvailable();
  const title = t('develop.graphql.title');
  return (
    <Page width="full">
      <PageHeader title={title} badge={<InfoHint about={title}>{t('develop.graphql.hint')}</InfoHint>} />
      {available.isPending ? (
        <LoadingState rows={6} />
      ) : available.data ? (
        <iframe
          title={t('develop.graphql.frame')}
          src={src}
          className="block h-[calc(100dvh-10.25rem)] min-h-[28rem] w-full rounded-xl border bg-card md:h-[calc(100dvh-12.25rem)] lg:h-[calc(100dvh-9.25rem)]"
        />
      ) : (
        <EmptyState
          icon={Workflow}
          title={t('develop.graphql.unavailable')}
          description={t('develop.graphql.unavailableDescription')}
        />
      )}
    </Page>
  );
};
