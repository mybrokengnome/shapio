import type { ModelDefinition } from '@shapio/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { entryQueryOptions } from '@/api/content';
import { queryKeys } from '@/api/queryKeys';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import type { FormValues } from '@/fields/helpers/values';
import { reportError } from '@/helpers/reportError';
import { EntryDocument } from '../Entry';
import type { ContentSchema } from '../hooks/useContentSchema';
import { useEntryForLocale } from '../hooks/useEntryForLocale';

type EntryLoaderProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  entryId: string;
  locale: string | null;
  onLocaleChange: (code: string) => void;
};

/**
 * Loads an entry in one locale and opens the form. "Reload" (after a conflict, a restore or creating a
 * locale) refetches the entry, and the schema when it changed, then starts the form again.
 */
export const EntryLoader = ({ schema, model, entryId, locale, onLocaleChange }: EntryLoaderProps) => {
  const queryClient = useQueryClient();
  const loaded = useEntryForLocale(model, entryId, locale);
  const [generation, setGeneration] = useState<{ token: number; carry: FormValues | undefined }>({
    token: 0,
    carry: undefined,
  });
  const reload = async (carry: FormValues | null) => {
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.schema.all });
      await queryClient.fetchQuery({
        ...entryQueryOptions(model.apiKey, entryId, locale ?? undefined),
        staleTime: 0,
      });
    } catch (error) {
      reportError(error, 'reloading an entry');
    }
    setGeneration((current) => ({ token: current.token + 1, carry: carry ?? undefined }));
  };
  if (loaded.error) {
    return <ErrorState error={loaded.error} onRetry={() => void loaded.refetch()} />;
  }
  if (!loaded.mode) {
    return <LoadingState rows={6} />;
  }
  return (
    <EntryDocument
      key={`${entryId}:${locale ?? ''}:${loaded.mode.kind}:${generation.token}`}
      schema={schema}
      model={model}
      mode={loaded.mode}
      locale={locale}
      carry={generation.carry}
      onReload={(carry) => void reload(carry)}
      onLocaleChange={onLocaleChange}
    />
  );
};
