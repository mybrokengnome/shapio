import type { ModelDefinition } from '@shapio/schema';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { useCreateEntry } from '@/api/content';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { useFieldsEnvironment } from '../../form/context';
import { EntryFields } from '../../form/EntryFields';
import { FieldsProvider } from '../../form/FieldsProvider';
import { createEntryFormStore, selectDirtyKeys } from '../../form/store';
import { contentIssuesOf } from '../../helpers/apiErrors';
import { buildCreateData, defaultFormValues, liveFields } from '../../helpers/formValues';

type InlineCreateSheetProps = {
  target: ModelDefinition;
  onClose: () => void;
  onCreated: (id: string) => void;
};

/**
 * Creates an entry of a relation's target model without leaving the form (the relation editor's
 * `allowInlineCreate` option). The server checks the create permission; a refusal shows here.
 */
export const InlineCreateSheet = ({ target, onClose, onCreated }: InlineCreateSheetProps) => {
  const { t } = useTranslation();
  const outer = useFieldsEnvironment();
  const [store] = useState(() => createEntryFormStore(defaultFormValues(target.fields)));
  const dirty = useStore(store, (state) => selectDirtyKeys(state).length > 0);
  const create = useCreateEntry(target.apiKey);
  const { requestOpenChange, discardPrompt } = useDiscardGuard({
    dirty,
    pending: create.isPending,
    onOpenChange: (open) => (open ? undefined : onClose()),
  });
  const locale = target.localized ? outer.locale : null;
  const environment = useMemo(
    () => ({
      ...outer,
      idPrefix: `${outer.idPrefix}inline-`,
      model: target,
      locale,
      entryId: null,
      readOnly: false,
      disabled: create.isPending,
    }),
    [outer, target, locale, create.isPending],
  );
  const submit = async () => {
    store.getState().reveal();
    try {
      const entry = await create.mutateAsync({
        ...(locale ? { locale } : {}),
        data: buildCreateData(store.getState().values),
      });
      onCreated(entry.id);
    } catch (error) {
      // Logged by the mutation cache; issues show on the fields, anything else above the buttons.
      store.getState().setIssues(contentIssuesOf(error));
    }
  };
  const issues = contentIssuesOf(create.error);
  return (
    <>
      <Sheet open onOpenChange={requestOpenChange}>
        <SheetContent size="md" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('content.relation.createTitle', { model: target.label })}</SheetTitle>
          </SheetHeader>
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <SheetBody className="space-y-5">
              <FieldsProvider environment={environment} store={store}>
                <EntryFields fields={liveFields(target.fields)} />
              </FieldsProvider>
              {create.isError && issues.length === 0 ? <FormError error={create.error} /> : null}
              {issues.length > 0 ? (
                <p role="alert" className="text-sm text-destructive">
                  {t('content.form.fixProblems', { count: issues.length })}
                </p>
              ) : null}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => requestOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <SubmitButton pending={create.isPending} pendingLabel={t('content.form.creating')}>
                {t('content.relation.createAndLink')}
              </SubmitButton>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      {discardPrompt}
    </>
  );
};
