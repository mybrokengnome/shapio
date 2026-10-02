import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { FieldControl } from '../FieldControl';
import { FieldGrid } from '../FieldGrid';
import { SiblingValuesContext } from '../form/context';
import { liveFields } from '../helpers/formValues';
import { pointerOf } from '../helpers/issues';
import type { ItemValues } from '../helpers/values';

type ComponentItemFieldsProps = {
  component: ComponentDefinition;
  item: ItemValues;
  onItemChange: (item: ItemValues) => void;
  /** Pointer of the item, e.g. `/hero` or `/sections/2`. */
  path: string;
  /** `document`: label + value lines, as a component block in the entry canvas. */
  layout?: 'form' | 'document';
};

/** The fields of one component value (a single component, a repeatable item or a dynamic-zone item). */
export const ComponentItemFields = ({
  component,
  item,
  onItemChange,
  path,
  layout = 'form',
}: ComponentItemFieldsProps) => {
  const siblings = useMemo(() => ({ definition: component, values: item }), [component, item]);
  const fields = liveFields(component.fields);
  const renderField = (field: FieldDefinition, className?: string) => (
    <FieldControl
      key={field.id}
      field={field}
      owner={component}
      value={item[field.apiKey]}
      onChange={(next) => onItemChange({ ...item, [field.apiKey]: next })}
      path={pointerOf(path, field.apiKey)}
      topLevel={false}
      layout={layout === 'document' ? 'inline' : 'stacked'}
      className={className}
    />
  );
  return (
    <SiblingValuesContext.Provider value={siblings}>
      {layout === 'document' ? (
        <div className="space-y-3">{fields.map((field) => renderField(field))}</div>
      ) : (
        <FieldGrid fields={fields} renderField={renderField} />
      )}
    </SiblingValuesContext.Provider>
  );
};
