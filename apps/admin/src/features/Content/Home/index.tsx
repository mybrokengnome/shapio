import { Link, Navigate } from '@tanstack/react-router';
import { Boxes } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { useContentSchema } from '../hooks/useContentSchema';

/** `/content`: opens the first model's content, or explains that a model comes first. */
export const ContentHome = () => {
  const { t } = useTranslation();
  const { schema, error } = useContentSchema();
  if (error) {
    return <ErrorState error={error} />;
  }
  if (!schema) {
    return <LoadingState />;
  }
  const [first] = schema.sortedModels
    .filter((model) => model.kind === 'collection')
    .concat(schema.sortedModels);
  if (first) {
    return <Navigate to="/content/$modelKey" params={{ modelKey: first.apiKey }} replace />;
  }
  return (
    <Page>
      <PageHeader title={t('content.title')} />
      <EmptyState
        icon={Boxes}
        title={t('content.empty.title')}
        action={
          <Button asChild>
            <Link to="/models/new">{t('content.empty.action')}</Link>
          </Button>
        }
      />
    </Page>
  );
};
