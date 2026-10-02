import type { ComponentDefinition } from '@shapio/schema';
import { Fragment, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ComponentItemFields } from '../ComponentItemFields';
import { pointerOf } from '../helpers/issues';
import { summarizeItem } from '../helpers/summary';
import { COMPONENT_KEY, type ItemValues } from '../helpers/values';
import { useCollapsedItems } from '../hooks/useCollapsedItems';
import { useFocusNewItem } from '../hooks/useFocusNewItem';
import { useItemDrag } from '../hooks/useItemDrag';
import { useItemIssueCount } from '../hooks/useItemIssueCount';
import type { useListEditor } from '../hooks/useListEditor';
import { ItemCard } from '../ItemCard';
import { ItemInserter } from '../ItemInserter';

type ListEditor = ReturnType<typeof useListEditor>;

type CanvasItemListProps = {
  list: ListEditor;
  labelId: string;
  inputId: string;
  path: string;
  editable: boolean;
  /** What can be inserted between blocks (empty when the list is full). */
  insertable: readonly ComponentDefinition[];
  /** The component an item is (a zone item's `__component`, or the repeatable's one). */
  componentOf: (item: ItemValues) => ComponentDefinition | undefined;
  newItem: (component: ComponentDefinition) => ItemValues;
  startCollapsed: boolean;
};

type BlockProps = {
  list: ListEditor;
  item: ItemValues;
  itemKey: string;
  index: number;
  path: string;
  domId: string;
  editable: boolean;
  component: ComponentDefinition | undefined;
  collapsed: boolean;
  onToggle: (key: string) => void;
  drag: ReturnType<typeof useItemDrag>;
};

const Block = ({
  list,
  item,
  itemKey,
  index,
  path,
  domId,
  editable,
  component,
  collapsed,
  onToggle,
  drag,
}: BlockProps) => {
  const { t } = useTranslation();
  const itemPath = pointerOf(path, index);
  const issueCount = useItemIssueCount(itemPath);
  const onItemChange = useCallback((next: ItemValues) => list.update(index, next), [list, index]);
  return (
    <ItemCard
      id={domId}
      appearance="canvas"
      title={component?.label ?? t('content.items.unknownComponent', { key: String(item[COMPONENT_KEY]) })}
      summary={component ? summarizeItem(component, item) : ''}
      index={index}
      count={list.items.length}
      collapsed={collapsed}
      issueCount={issueCount}
      editable={editable}
      onToggle={() => onToggle(itemKey)}
      onMove={(to) => list.move(index, to)}
      onDuplicate={component ? () => list.duplicate(index) : undefined}
      onRemove={() => list.remove(index)}
      drag={{
        handle: drag.handleProps(index),
        target: drag.targetProps(index),
        dropSide: drag.dropSide(index),
      }}
    >
      {component ? (
        <ComponentItemFields
          component={component}
          item={item}
          onItemChange={onItemChange}
          path={itemPath}
          layout="document"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('content.items.unknownComponentHint')}</p>
      )}
    </ItemCard>
  );
};

/**
 * A dynamic zone or repeatable component as blocks of the entry canvas: each item a block with a compact
 * header (actions on hover), its fields as label + value lines, insertion points between blocks, and drag
 * (or ⌥↑↓) to reorder. Adding at the field's start or end is the canvas's boundary inserter.
 */
export const CanvasItemList = ({
  list,
  labelId,
  inputId,
  path,
  editable,
  insertable,
  componentOf,
  newItem,
  startCollapsed,
}: CanvasItemListProps) => {
  const { collapsed, toggle } = useCollapsedItems(list.keys, startCollapsed);
  const domId = useCallback((key: string) => `${inputId}-item-${key}`, [inputId]);
  useFocusNewItem(list.keys, domId);
  const drag = useItemDrag(list.move);
  if (list.items.length === 0) {
    return null;
  }
  return (
    <ol aria-labelledby={labelId} className="space-y-1 font-sans">
      {list.items.map((item, index) => {
        const key = list.keys[index] ?? String(index);
        return (
          <Fragment key={key}>
            {index > 0 && editable && insertable.length > 0 ? (
              <ItemInserter
                components={insertable}
                position={index + 1}
                onInsert={(component) => list.insertAt(index, newItem(component))}
              />
            ) : null}
            <Block
              list={list}
              item={item}
              itemKey={key}
              index={index}
              path={path}
              domId={domId(key)}
              editable={editable}
              component={componentOf(item)}
              collapsed={collapsed.has(key)}
              onToggle={toggle}
              drag={drag}
            />
          </Fragment>
        );
      })}
    </ol>
  );
};
