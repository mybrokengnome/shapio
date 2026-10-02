import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { EntryLoader } from '../EntryLoader';
import { useContentLocales } from '../hooks/useContentLocales';
import { useModelRoute } from '../hooks/useModelRoute';
import { ModelMissing } from '../ModelMissing';

/** `/content/$modelKey/$entryId?locale=`: edit one entry in one locale. */
export const EntryEditor = () => {
  const { modelKey, entryId } = useParams({ from: '/app/content/$modelKey/$entryId' });
  const search = useSearch({ from: '/app/content/$modelKey/$entryId' });
  const navigate = useNavigate({ from: '/content/$modelKey/$entryId' });
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
    <EntryLoader
      schema={schema}
      model={model}
      entryId={entryId}
      locale={locales.current}
      onLocaleChange={(locale) => void navigate({ search: { locale } })}
    />
  );
};
