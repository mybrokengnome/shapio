import type { ComponentDefinition } from '@shapio/schema';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CanvasItemList } from '../CanvasItemList';
import { ComponentItemFields } from '../ComponentItemFields';
import { useFieldsEnvironment } from '../form/context';
import { newComponentItem } from '../helpers/formValues';
import { pointerOf } from '../helpers/issues';
import { summarizeItem } from '../helpers/summary';
import { isRecord, type ItemValues } from '../helpers/values';
import { useCollapsedItems } from '../hooks/useCollapsedItems';
import { useFocusNewItem } from '../hooks/useFocusNewItem';
import { useItemIssueCount } from '../hooks/useItemIssueCount';
import { useListEditor } from '../hooks/useListEditor';
import { ItemCard } from '../ItemCard';
import type { BuiltInEditorProps } from '../types';

type RepeatableItemProps = {
  component: ComponentDefinition;
  item: ItemValues;
  itemKey: string;
  index: number;
  count: number;
  path: string;
  domId: string;
  collapsed: boolean;
  editable: boolean;
  list: ReturnType<typeof useListEditor>;
  onToggle: (key: string) => void;
};

const RepeatableItem = ({
  component,
  item,
  itemKey,
  index,
  count,
  path,
  domId,
  collapsed,
  editable,
  list,
  onToggle,
}: RepeatableItemProps) => {
  const itemPath = pointerOf(path, index);
  const issueCount = useItemIssueCount(itemPath);
  const onItemChange = useCallback((next: ItemValues) => list.update(index, next), [list, index]);
  return (
    <ItemCard
      id={domId}
      title={component.label}
      summary={summarizeItem(component, item)}
      index={index}
      count={count}
      collapsed={collapsed}
      issueCount={issueCount}
      editable={editable}
      onToggle={() => onToggle(itemKey)}
      onMove={(to) => list.move(index, to)}
      onDuplicate={() => list.duplicate(index)}
      onRemove={() => list.remove(index)}
    >
      <ComponentItemFields component={component} item={item} onItemChange={onItemChange} path={itemPath} />
    </ItemCard>
  );
};

/** The repeatable list as blocks of the entry canvas. */
const CanvasRepeatable = (props: BuiltInEditorProps & { component: ComponentDefinition }) => {
  const { component, value, onChange, path, labelId, inputId, readOnly, disabled, definition, field } = props;
  const list = useListEditor(value, onChange);
  const max = definition.type === 'component' ? definition.settings.max : undefined;
  return (
    <CanvasItemList
      list={list}
      labelId={labelId}
      inputId={inputId}
      path={path}
      editable={!readOnly && !disabled}
      insertable={max === undefined || list.items.length < max ? [component] : []}
      componentOf={() => component}
      newItem={(next) => newComponentItem(next, false)}
      startCollapsed={field.options.collapsed === true}
    />
  );
};

const Repeatable = (props: BuiltInEditorProps & { component: ComponentDefinition }) => {
  const { t } = useTranslation();
  const { component, value, onChange, path, labelId, inputId, readOnly, disabled, definition } = props;
  const list = useListEditor(value, onChange);
  const { collapsed, toggle } = useCollapsedItems(list.keys, props.field.options.collapsed === true);
  const domId = useCallback((key: string) => `${inputId}-item-${key}`, [inputId]);
  useFocusNewItem(list.keys, domId);
  const max = definition.type === 'component' ? definition.settings.max : undefined;
  const editable = !readOnly && !disabled;
  return (
    <div className="space-y-3">
      {list.items.length > 0 ? (
        <ol aria-labelledby={labelId} className="space-y-2">
          {list.items.map((item, index) => {
            const key = list.keys[index] ?? String(index);
            return (
              <RepeatableItem
                key={key}
                component={component}
                item={item}
                itemKey={key}
                index={index}
                count={list.items.length}
                path={path}
                domId={domId(key)}
                collapsed={collapsed.has(key)}
                editable={editable}
                list={list}
                onToggle={toggle}
              />
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t('content.items.empty')}</p>
      )}
      {editable && (max === undefined || list.items.length < max) ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => list.add(newComponentItem(component, false))}
        >
          <Plus aria-hidden="true" />
          {t('content.items.add', { item: component.label })}
        </Button>
      ) : null}
    </div>
  );
};

const Single = (props: BuiltInEditorProps & { component: ComponentDefinition }) => {
  const { t } = useTranslation();
  const { component, value, onChange, path, readOnly, disabled, field } = props;
  const editable = !readOnly && !disabled;
  const onItemChange = useCallback((next: ItemValues) => onChange(next), [onChange]);
  if (!isRecord(value)) {
    return editable ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(newComponentItem(component, false))}
      >
        <Plus aria-hidden="true" />
        {t('content.items.add', { item: component.label })}
      </Button>
    ) : (
      <p className="text-sm text-muted-foreground">{t('content.items.empty')}</p>
    );
  }
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <ComponentItemFields component={component} item={value} onItemChange={onItemChange} path={path} />
      {editable && !field.required ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          <Trash2 aria-hidden="true" />
          {t('content.items.removeSingle', { item: component.label })}
        </Button>
      ) : null}
    </div>
  );
};

/** `componentEditor`: a reusable group of fields, once or as a repeatable list. */
export const ComponentField = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { components } = useFieldsEnvironment();
  const { definition } = props;
  const component =
    definition.type === 'component' ? components.get(definition.settings.component) : undefined;
  if (!component || definition.type !== 'component') {
    return <p className="text-sm text-destructive">{t('content.items.componentMissing')}</p>;
  }
  if (definition.settings.repeatable && props.appearance === 'canvas') {
    return <CanvasRepeatable {...props} component={component} />;
  }
  return definition.settings.repeatable ? (
    <Repeatable {...props} component={component} />
  ) : (
    <Single {...props} component={component} />
  );
};
