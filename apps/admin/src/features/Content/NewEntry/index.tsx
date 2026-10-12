import { linkOptions, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { NoAccess } from '@/components/NoAccess';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { canOnModel } from '@/helpers/modelPermissions';
import { EntryDocument } from '../Entry';
import { EntryFrame } from '../EntryFrame';
import { useContentLocales } from '../hooks/useContentLocales';
import { useModelRoute } from '../hooks/useModelRoute';
import { ModelMissing } from '../ModelMissing';

const CREATE = { kind: 'create' } as const;

/** `/content/$modelKey/new?locale=`: a new entry, created on the first Save (fully validated). */
export const NewEntry = () => {
  const { modelKey } = useParams({ from: '/app/content/$modelKey/new' });
  const search = useSearch({ from: '/app/content/$modelKey/new' });
  const navigate = useNavigate({ from: '/content/$modelKey/new' });
  const { t } = useTranslation();
  const me = useMe().data;
  const { schema, model, error, pending } = useModelRoute(modelKey);
  const locales = useContentLocales(model, search.locale);
  if (error || locales.error) {
    return <ErrorState error={error ?? locales.error} />;
  }
  if (pending || locales.isPending || !schema) {
    return <LoadingState rows={6} />;
  }
  if (!model) {
    return <ModelMissing modelKey={modelKey} />;
  }
  if (!canOnModel(me, model.id, 'create')) {
    return (
      <Page>
        <PageHeader
          breadcrumb={[
            { label: model.label, link: linkOptions({ to: '/content/$modelKey', params: { modelKey } }) },
          ]}
          title={t('content.form.newTitle', { model: model.label })}
        />
        <NoAccess />
      </Page>
    );
  }
  return (
    <EntryFrame model={model} modelKey={modelKey}>
      <EntryDocument
        key={locales.current ?? ''}
        schema={schema}
        model={model}
        mode={CREATE}
        locale={locales.current}
        onReload={() => undefined}
        onLocaleChange={(locale) => void navigate({ search: { locale } })}
      />
    </EntryFrame>
  );
};
