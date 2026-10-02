import type { FieldDefinition } from '@shapio/schema';
import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CanvasBlock } from '@/fields/CanvasBlock';
import { CanvasHandlesContext, type CanvasHandles } from '@/fields/form/canvasHandles';
import { useEntryForm, useFieldsEnvironment } from '@/fields/form/context';
import { useTopLevelValue } from '@/fields/hooks/useTopLevelValue';
import { BoundaryInserter } from '../BoundaryInserter';
import { useCanvasInsertions } from '../hooks/useCanvasInsertions';

type CanvasProps = { fields: readonly FieldDefinition[] };

const CanvasField = memo(({ field }: { field: FieldDefinition }) => {
  const { model } = useFieldsEnvironment();
  const { value, onChange } = useTopLevelValue(field);
  return (
    <CanvasBlock
      field={field}
      owner={model}
      value={value}
      onChange={onChange}
      path={`/${field.apiKey}`}
      showScope={model.localized}
    />
  );
});

CanvasField.displayName = 'CanvasField';

/**
 * The writing surface: the model's canvas fields in order, each owning its blocks (stored formats are
 * unchanged, and blocks never move between fields). Between fields, and after the last, a `+` offers what
 * can be stored there.
 */
export const Canvas = ({ fields }: CanvasProps) => {
  const { t } = useTranslation();
  const [handles] = useState<CanvasHandles>(() => new Map());
  return (
    <CanvasHandlesContext.Provider value={handles}>
      <section aria-label={t('entry.canvas.label')} className="space-y-2" data-canvas>
        <CanvasFields fields={fields} />
      </section>
    </CanvasHandlesContext.Provider>
  );
};

const CanvasFields = ({ fields }: CanvasProps) => {
  const actions = useCanvasInsertions();
  // Re-read what fits whenever values change (a list reaching its max offers nothing more).
  useEntryForm((state) => state.values);
  return fields.map((field, index) => {
    const next = fields[index + 1];
    return (
      <Fragment key={field.id}>
        <CanvasField field={field} />
        <BoundaryInserter
          actions={actions}
          final={next === undefined}
          targets={[
            { insertions: actions.insertionsOf(field), edge: 'end' },
            ...(next ? [{ insertions: actions.insertionsOf(next), edge: 'start' as const }] : []),
          ]}
        />
      </Fragment>
    );
  });
};
