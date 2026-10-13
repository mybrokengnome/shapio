import type { ModelDefinition } from '@shapio/schema';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { useCreateEntry } from '@/api/content';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { useFieldsEnvironment } from '../../form/context';
import { EntryFields } from '../../form/EntryFields';
import { FieldsProvider } from '../../form/FieldsProvider';
import { refuseUnparsed } from '../../form/refuseUnparsed';
import { createEntryFormStore, selectDirtyKeys, type EntryFormStore } from '../../form/store';
import { contentIssuesOf } from '../../helpers/apiErrors';
import { buildCreateData, defaultFormValues, liveFields } from '../../helpers/formValues';
import { fieldGridModeOf } from '../../helpers/widthClasses';

type InlineCreateSheetProps = {
  target: ModelDefinition;
  /** The target type and its kinds in tree order, when it has kinds: the new entry's kind is chosen first. */
  kinds: readonly ModelDefinition[];
  onClose: () => void;
  onCreated: (id: string) => void;
};

/** A fresh form for `kind`, keeping what was typed into the fields it shares with the previous kind. */
const storeForKind = (kind: ModelDefinition, previous?: EntryFormStore) => {
  const store = createEntryFormStore(defaultFormValues(kind.fields));
  if (previous) {
    const values = previous.getState().values;
    const shared = new Set(kind.fields.map((field) => field.apiKey));
    store
      .getState()
      .patchValues(Object.fromEntries(Object.entries(values).filter(([key]) => shared.has(key))));
  }
  return store;
};

/**
 * Creates an entry of a relation's target model without leaving the form (the relation editor's
 * `allowInlineCreate` option). A target with kinds asks which kind first (a small select above the form);
 * switching keeps the shared fields' values. The server checks the create permission; a refusal shows here.
 */
export const InlineCreateSheet = ({ target: type, kinds, onClose, onCreated }: InlineCreateSheetProps) => {
  const { t } = useTranslation();
  const kindId = useId();
  const outer = useFieldsEnvironment();
  const [target, setTarget] = useState(type);
  const [store, setStore] = useState(() => storeForKind(type));
  const dirty = useStore(store, (state) => selectDirtyKeys(state).length > 0);
  const create = useCreateEntry(target.apiKey);
  const changeKind = (apiKey: string) => {
    const next = kinds.find((kind) => kind.apiKey === apiKey);
    if (next && next.id !== target.id) {
      setStore(storeForKind(next, store));
      setTarget(next);
      create.reset();
    }
  };
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
    if (refuseUnparsed(store)) {
      return;
    }
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
            <SheetTitle>{t('content.relation.createTitle', { model: type.label })}</SheetTitle>
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
              {kinds.length > 1 ? (
                <div className="space-y-2">
                  <Label htmlFor={kindId}>{t('content.relation.kind')}</Label>
                  <Select value={target.apiKey} onValueChange={changeKind} disabled={create.isPending}>
                    <SelectTrigger id={kindId} size="sm" className="w-full sm:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {kinds.map((kind) => (
                        <SelectItem key={kind.id} value={kind.apiKey}>
                          {kind.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <FieldsProvider key={target.id} environment={environment} store={store}>
                <EntryFields fields={liveFields(target.fields)} mode={fieldGridModeOf(target)} />
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
