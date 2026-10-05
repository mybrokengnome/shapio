import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { useMemo, type ReactNode } from 'react';
import { cn } from '@/helpers/cn';
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
  /** Extra content under a field (the SEO editor's length counters), keyed on the field's stable ID. */
  renderFieldFooter?: (field: FieldDefinition, value: unknown) => ReactNode;
};

/** The fields of one component value (a single component, a repeatable item or a dynamic-zone item). */
export const ComponentItemFields = ({
  component,
  item,
  onItemChange,
  path,
  layout = 'form',
  renderFieldFooter,
}: ComponentItemFieldsProps) => {
  const siblings = useMemo(() => ({ definition: component, values: item }), [component, item]);
  const fields = liveFields(component.fields);
  const renderField = (field: FieldDefinition, className?: string) => {
    // Always wrapped when footers are on: a footer appearing must not remount the control (focus would go).
    const wrapped = renderFieldFooter !== undefined;
    const control = (
      <FieldControl
        key={field.id}
        field={field}
        owner={component}
        value={item[field.apiKey]}
        onChange={(next) => onItemChange({ ...item, [field.apiKey]: next })}
        path={pointerOf(path, field.apiKey)}
        topLevel={false}
        layout={layout === 'document' ? 'inline' : 'stacked'}
        className={wrapped ? undefined : className}
      />
    );
    return wrapped ? (
      <div key={field.id} className={cn('min-w-0 space-y-1.5', className)}>
        {control}
        {renderFieldFooter(field, item[field.apiKey])}
      </div>
    ) : (
      control
    );
  };
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
