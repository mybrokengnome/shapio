import { isComponentDefinition, isModelDefinition, type SchemaDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingState } from '@/components/LoadingState';
import type { FieldsEnvironment } from '@/fields/form/context';
import { EntryFields } from '@/fields/form/EntryFields';
import { FieldsProvider } from '@/fields/form/FieldsProvider';
import { createEntryFormStore } from '@/fields/form/store';
import { defaultFormValues } from '@/fields/helpers/formValues';
import { fieldGridModeOf } from '@/fields/helpers/widthClasses';
import { useRuntimeEditors } from '@/fields/runtime/useRuntimeEditors';
import { previewHostOf, previewSections } from '../../helpers/previewSections';

type FormPreviewProps = {
  definition: SchemaDefinition;
  /** Every loaded definition (relation targets, components); `definition` replaces its loaded version. */
  definitions: readonly SchemaDefinition[];
};

const pickNothing = () => Promise.resolve(null);

/**
 * The entry form the definition produces, read-only, with the same field editors and layout the entry
 * editor uses (default values filled in). Components are shown as their own fields.
 */
export const FormPreview = ({ definition, definitions }: FormPreviewProps) => {
  const { t } = useTranslation();
  const runtime = useRuntimeEditors();
  const model = useMemo(
    () => (isModelDefinition(definition) ? definition : previewHostOf(definition)),
    [definition],
  );
  const environment = useMemo<FieldsEnvironment>(() => {
    const all = [...definitions.filter((other) => other.id !== definition.id), definition];
    return {
      idPrefix: 'schema-preview-',
      model,
      models: new Map(all.filter(isModelDefinition).map((entry) => [entry.id, entry])),
      components: new Map(all.filter(isComponentDefinition).map((entry) => [entry.id, entry])),
      locale: null,
      entryId: null,
      readOnly: true,
      disabled: false,
      runtimeEditors: runtime.editors,
      pickMedia: pickNothing,
    };
  }, [definition, definitions, model, runtime.editors]);
  const store = useMemo(() => createEntryFormStore(defaultFormValues(model.fields)), [model]);

  if (runtime.isLoading) {
    return <LoadingState rows={4} />;
  }
  const sections = previewSections(model);
  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('develop.schema.preview.noFields')}</p>;
  }
  return (
    <FieldsProvider environment={environment} store={store}>
      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`schema-preview-${section.id}`} className="space-y-3">
            <h3
              id={`schema-preview-${section.id}`}
              className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {section.label ??
                (section.kind === 'document'
                  ? t('develop.schema.preview.document')
                  : t('develop.schema.preview.properties'))}
            </h3>
            <EntryFields fields={section.fields} mode={fieldGridModeOf(model)} />
          </section>
        ))}
      </div>
    </FieldsProvider>
  );
};
