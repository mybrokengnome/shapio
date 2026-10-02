import type { ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useEntry } from '@/api/content';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { quickEditFieldsOf } from '../helpers/quickEditFields';
import type { RowContext } from '../Row';
import { Form } from './Form';

type QuickEditProps = {
  quickEdit: NonNullable<RowContext['quickEdit']>;
  model: ModelDefinition;
  entryId: string;
  label: string;
  locale: string | null;
  onClose: () => void;
};

/**
 * A row's quick edit, shown right under the row (a table row or a phone row): the entry's properties with
 * the document's field editors, without opening the document.
 */
export const QuickEdit = ({ quickEdit, model, entryId, label, locale, onClose }: QuickEditProps) => {
  const entry = useEntry(model.apiKey, entryId, locale ?? undefined);
  const fields = useMemo(() => quickEditFieldsOf(model), [model]);
  if (entry.isPending) {
    return <LoadingState rows={2} />;
  }
  if (entry.isError) {
    return <ErrorState size="panel" error={entry.error} onRetry={() => void entry.refetch()} />;
  }
  return (
    <Form
      schema={quickEdit.schema}
      carry={quickEdit.getDraft()}
      onDraftChange={quickEdit.setDraft}
      model={model}
      entry={entry.data}
      fields={fields}
      label={label}
      locale={locale}
      onClose={onClose}
    />
  );
};
