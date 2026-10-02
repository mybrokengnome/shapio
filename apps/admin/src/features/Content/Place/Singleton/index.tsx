import type { ModelDefinition } from '@shapio/schema';
import { useEntryList } from '@/api/content';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { EntryDocument } from '../../Entry';
import { EntryLoader } from '../../EntryLoader';
import type { ContentSchema } from '../../hooks/useContentSchema';

const CREATE = { kind: 'create' } as const;

type SingletonProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  locale: string | null;
  onLocaleChange: (code: string) => void;
};

/** A single type has one entry: its document opens directly (or a new one, before it exists). */
export const Singleton = ({ schema, model, locale, onLocaleChange }: SingletonProps) => {
  const list = useEntryList(model.apiKey, { pageSize: 1 });
  if (list.isError) {
    return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  }
  if (list.isPending) {
    return <LoadingState rows={6} />;
  }
  const [entry] = list.data.items;
  return entry ? (
    <EntryLoader
      schema={schema}
      model={model}
      entryId={entry.id}
      locale={locale}
      onLocaleChange={onLocaleChange}
    />
  ) : (
    <EntryDocument
      key={locale ?? ''}
      schema={schema}
      model={model}
      mode={CREATE}
      locale={locale}
      onReload={() => undefined}
      onLocaleChange={onLocaleChange}
    />
  );
};
