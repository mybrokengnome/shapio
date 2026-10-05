import type { ComponentDefinition } from '@shapio/schema';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CanvasItemList } from '../CanvasItemList';
import { ComponentItemFields } from '../ComponentItemFields';
import { EmptyListRow } from '../EmptyListRow';
import { newComponentItem } from '../helpers/formValues';
import { pointerOf } from '../helpers/issues';
import { hasRoomFor } from '../helpers/listLimits';
import { summarizeItem } from '../helpers/summary';
import { COMPONENT_KEY, type ItemValues } from '../helpers/values';
import { useAllowedComponents } from '../hooks/useAllowedComponents';
import { useCollapsedItems } from '../hooks/useCollapsedItems';
import { useFocusNewItem } from '../hooks/useFocusNewItem';
import { useItemIssueCount } from '../hooks/useItemIssueCount';
import { useListEditor } from '../hooks/useListEditor';
import { ItemCard } from '../ItemCard';
import type { BuiltInEditorProps } from '../types';
import { AddSectionMenu } from './AddSectionMenu';

type ZoneItemProps = {
  allowed: readonly ComponentDefinition[];
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

const ZoneItem = ({
  allowed,
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
}: ZoneItemProps) => {
  const { t } = useTranslation();
  const component = allowed.find((candidate) => candidate.apiKey === item[COMPONENT_KEY]);
  const itemPath = pointerOf(path, index);
  const issueCount = useItemIssueCount(itemPath);
  const onItemChange = useCallback((next: ItemValues) => list.update(index, next), [list, index]);
  return (
    <ItemCard
      id={domId}
      title={component?.label ?? t('content.items.unknownComponent', { key: String(item[COMPONENT_KEY]) })}
      summary={component ? summarizeItem(component, item) : ''}
      index={index}
      count={count}
      collapsed={collapsed}
      issueCount={issueCount}
      editable={editable}
      onToggle={() => onToggle(itemKey)}
      onMove={(to) => list.move(index, to)}
      onDuplicate={component ? () => list.duplicate(index) : undefined}
      onRemove={() => list.remove(index)}
    >
      {component ? (
        <ComponentItemFields component={component} item={item} onItemChange={onItemChange} path={itemPath} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('content.items.unknownComponentHint')}</p>
      )}
    </ItemCard>
  );
};

/**
 * The zone as blocks of the entry canvas. Empty, it says so in a row with "Add section" (and the minimum,
 * when one section would not be enough); the list stays mounted so the first section added gets focus.
 */
const CanvasZone = (props: BuiltInEditorProps) => {
  const { value, onChange, path, labelId, inputId, readOnly, disabled, definition, field } = props;
  const list = useListEditor(value, onChange);
  const allowed = useAllowedComponents(definition);
  const settings = definition.type === 'dynamiczone' ? definition.settings : undefined;
  const editable = !readOnly && !disabled;
  const room = hasRoomFor(list.items.length, settings?.max);
  return (
    <div>
      {list.items.length === 0 ? (
        <EmptyListRow
          min={settings?.min}
          action={
            editable && room && allowed.length > 0 ? (
              <AddSectionMenu
                allowed={allowed}
                onAdd={(component) => list.add(newComponentItem(component, true))}
              />
            ) : null
          }
        />
      ) : null}
      <CanvasItemList
        list={list}
        labelId={labelId}
        inputId={inputId}
        path={path}
        editable={editable}
        insertable={room ? allowed : []}
        componentOf={(item) => allowed.find((candidate) => candidate.apiKey === item[COMPONENT_KEY])}
        newItem={(component) => newComponentItem(component, true)}
        startCollapsed={field.options.collapsed === true}
      />
    </div>
  );
};

/**
 * `dynamicZoneEditor`: an ordered list of sections, each one of the zone's allowed components. Sections can
 * be added by type, reordered (buttons or Alt+↑/↓), duplicated, collapsed (with a readable summary) and
 * removed.
 */
export const DynamicZoneField = (props: BuiltInEditorProps) =>
  props.appearance === 'canvas' ? <CanvasZone {...props} /> : <FormZone {...props} />;

const FormZone = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { value, onChange, path, labelId, inputId, readOnly, disabled, definition, field } = props;
  const list = useListEditor(value, onChange);
  const { collapsed, toggle, setAll } = useCollapsedItems(list.keys, field.options.collapsed === true);
  const domId = useCallback((key: string) => `${inputId}-item-${key}`, [inputId]);
  useFocusNewItem(list.keys, domId);
  const allowed = useAllowedComponents(definition);
  const max = definition.type === 'dynamiczone' ? definition.settings.max : undefined;
  const editable = !readOnly && !disabled;
  const allCollapsed = list.keys.length > 0 && list.keys.every((key) => collapsed.has(key));
  return (
    <div className="space-y-3">
      {list.items.length > 1 ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(list.keys, !allCollapsed)}>
            {allCollapsed ? <ChevronsUpDown aria-hidden="true" /> : <ChevronsDownUp aria-hidden="true" />}
            {allCollapsed ? t('content.items.expandAll') : t('content.items.collapseAll')}
          </Button>
        </div>
      ) : null}
      {list.items.length > 0 ? (
        <ol aria-labelledby={labelId} className="space-y-2">
          {list.items.map((item, index) => {
            const key = list.keys[index] ?? String(index);
            return (
              <ZoneItem
                key={key}
                allowed={allowed}
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
        <p className="text-sm text-muted-foreground">{t('content.items.emptyZone')}</p>
      )}
      {editable && hasRoomFor(list.items.length, max) ? (
        <AddSectionMenu
          allowed={allowed}
          onAdd={(component) => list.add(newComponentItem(component, true))}
        />
      ) : null}
    </div>
  );
};
