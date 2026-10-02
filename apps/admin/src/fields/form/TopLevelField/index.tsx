import type { FieldDefinition } from '@shapio/schema';
import { memo } from 'react';
import { FieldControl, type FieldLayout } from '../../FieldControl';
import { useTopLevelValue } from '../../hooks/useTopLevelValue';
import { useFieldsEnvironment } from '../context';

type TopLevelFieldProps = {
  field: FieldDefinition;
  layout?: FieldLayout;
  className?: string;
};

/** A field of the entry itself, as a labelled control: subscribes to its own value only. */
export const TopLevelField = memo(({ field, layout, className }: TopLevelFieldProps) => {
  const { model } = useFieldsEnvironment();
  const { value, onChange } = useTopLevelValue(field);
  return (
    <FieldControl
      field={field}
      owner={model}
      value={value}
      onChange={onChange}
      path={`/${field.apiKey}`}
      topLevel
      layout={layout}
      className={className}
    />
  );
});

TopLevelField.displayName = 'TopLevelField';
