import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
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
