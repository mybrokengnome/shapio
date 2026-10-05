import { isSeoField, type ComponentDefinition, type FieldDefinition } from '@shapio/schema';
import { useCallback, useMemo } from 'react';
import { ComponentField } from '../ComponentField';
import { ComponentItemFields } from '../ComponentItemFields';
import { useFieldsEnvironment } from '../form/context';
import { newComponentItem } from '../helpers/formValues';
import { isRecord, type ItemValues } from '../helpers/values';
import type { BuiltInEditorProps } from '../types';
import { Counter } from './Counter';
import { seoCounterOf, seoKeysOf } from './helpers';
import { useSeoPreview } from './hooks/useSeoPreview';
import { Preview } from './Preview';

type SeoGroupProps = BuiltInEditorProps & { component: ComponentDefinition };

const renderCounter = (field: FieldDefinition, value: unknown) => {
  const counter = seoCounterOf(field.id, value);
  return counter ? <Counter counter={counter} /> : null;
};

/** The SEO group: its fields shown at once (an empty value starts on the first edit), counters, preview. */
const SeoGroup = ({ component, value, onChange, path }: SeoGroupProps) => {
  const item = useMemo(
    () => (isRecord(value) ? value : newComponentItem(component, false)),
    [value, component],
  );
  const onItemChange = useCallback((next: ItemValues) => onChange(next), [onChange]);
  const preview = useSeoPreview(component, value);
  const noindexKey = seoKeysOf(component).noindex;
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <ComponentItemFields
        component={component}
        item={item}
        onItemChange={onItemChange}
        path={path}
        renderFieldFooter={renderCounter}
      />
      <Preview preview={preview} noindex={noindexKey !== undefined && item[noindexKey] === true} />
    </div>
  );
};

/**
 * `seoEditor`: the built-in SEO component's fields with length counters on title and description and a
 * search-result preview. Any other component field (the editor chosen by hand) gets the plain component
 * editor.
 */
export const SeoField = (props: BuiltInEditorProps) => {
  const { components } = useFieldsEnvironment();
  const { definition } = props;
  const component =
    definition.type === 'component' && isSeoField(definition)
      ? components.get(definition.settings.component)
      : undefined;
  return component ? <SeoGroup {...props} component={component} /> : <ComponentField {...props} />;
};
