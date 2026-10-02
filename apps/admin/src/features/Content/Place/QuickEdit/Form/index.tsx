import type { AdminEntry } from '@shapio/client';
import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useStore } from 'zustand';
import { useSaveEntry } from '@/api/content';
import { FormError } from '@/components/FormError';
import { InlineConfirm } from '@/components/InlineConfirm';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { EntryFields } from '@/fields/form/EntryFields';
import { FieldsProvider } from '@/fields/form/FieldsProvider';
import { selectDirtyKeys } from '@/fields/form/store';
import { contentIssuesOf } from '@/fields/helpers/apiErrors';
import { buildPatch } from '@/fields/helpers/formValues';
import type { FormValues } from '@/fields/helpers/values';
import { useEntrySetup } from '../../../Entry/hooks/useEntrySetup';
import type { ContentSchema } from '../../../hooks/useContentSchema';

type FormProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  entry: AdminEntry;
  fields: readonly FieldDefinition[];
  label: string;
  locale: string | null;
  /** Unsaved changes from before a remount (the list switched layouts). */
  carry: FormValues | undefined;
  onDraftChange: (values: FormValues | undefined) => void;
  onClose: () => void;
};

/**
 * The quick edit form: the row's properties with the same field editors as the document, saved as one
 * revision (fully validated, with the version guard). Leaving with changes asks first.
 */
export const Form = ({
  schema,
  model,
  entry,
  fields,
  label,
  locale,
  carry,
  onDraftChange,
  onClose,
}: FormProps) => {
  const { t } = useTranslation();
  const save = useSaveEntry(model.apiKey);
  const [error, setError] = useState<unknown>(null);
  const setup = useEntrySetup({
    schema,
    model,
    mode: { kind: 'edit', entry },
    locale,
    carry,
    disabled: save.isPending,
    readOnly: false,
  });
  const { store } = setup;
  const environment = useMemo(() => ({ ...setup.environment, idPrefix: 'quick-' }), [setup.environment]);
  const dirty = useStore(store, (state) => selectDirtyKeys(state).length > 0);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(
    () =>
      store.subscribe((state) => {
        const keys = selectDirtyKeys(state);
        onDraftChange(
          keys.length > 0 ? Object.fromEntries(keys.map((key) => [key, state.values[key]])) : undefined,
        );
      }),
    [store, onDraftChange],
  );
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('input, textarea, [role="combobox"], button')?.focus();
  }, []);

  const submit = async () => {
    store.getState().reveal();
    const state = store.getState();
    const keys = selectDirtyKeys(state);
    if (keys.length === 0) {
      onClose();
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        id: entry.id,
        input: {
          ...(locale ? { locale } : {}),
          expectedVersion: entry.version,
          data: buildPatch(state.values, keys),
        },
      });
      toast.success(t('place.quickEdit.saved', { entry: label }));
      onClose();
    } catch (failure) {
      // Logged by the mutation cache; field issues show on the fields, anything else above the buttons.
      const issues = contentIssuesOf(failure);
      store.getState().setIssues(issues);
      setError(issues.length > 0 ? null : failure);
    }
  };
  const cancel = (
    <Button type="button" variant="outline" size="sm" onClick={dirty ? undefined : onClose}>
      {t('common.cancel')}
    </Button>
  );
  return (
    <form
      ref={formRef}
      noValidate
      aria-label={t('place.quickEdit.label', { entry: label })}
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !dirty && !event.defaultPrevented) {
          onClose();
        }
      }}
    >
      <UnsavedChangesGuard when={dirty} />
      <FieldsProvider environment={environment} store={store}>
        <EntryFields fields={fields} />
      </FieldsProvider>
      {error ? <FormError error={error} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty ? (
          <InlineConfirm
            tone="danger"
            side="top"
            title={t('place.quickEdit.discardTitle')}
            description={t('place.quickEdit.discardDescription')}
            confirmLabel={t('place.quickEdit.discard')}
            onConfirm={onClose}
            trigger={cancel}
          />
        ) : (
          cancel
        )}
        <SubmitButton size="sm" pending={save.isPending} pendingLabel={t('common.saving')}>
          {t('place.quickEdit.save')}
        </SubmitButton>
      </div>
      {setup.mediaDialog}
    </form>
  );
};
