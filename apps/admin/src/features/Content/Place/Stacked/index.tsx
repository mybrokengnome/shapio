import type { AdminEntryListItem, PresencePerson } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { labelOf } from '@/fields/helpers/titles';
import type { RowContext } from '../Row';
import { SelectAll } from '../SelectAll';
import { Item } from './Item';

type StackedProps = {
  context: RowContext;
  items: readonly AdminEntryListItem[];
  selected: ReadonlySet<string>;
  presence: ReadonlyMap<string, readonly PresencePerson[]>;
  onSelectChange: (ids: string[], checked: boolean) => void;
};

const NOBODY: readonly PresencePerson[] = [];

/** A place's entries on a phone: one stacked row each, nothing scrolls sideways (sorting is in Sort). */
export const Stacked = ({ context, items, selected, presence, onSelectChange }: StackedProps) => {
  const { t } = useTranslation();
  return (
    <div>
      <SelectAll
        ids={items.map((item) => item.id)}
        selected={selected}
        onSelectChange={onSelectChange}
        className="border-b px-4 py-3"
      />
      <ul aria-label={t('place.list.rowsLabel', { place: context.model.label })}>
        {items.map((item) => (
          <Item
            key={item.id}
            context={context}
            item={item}
            label={labelOf(context.model, item, t('content.untitled'))}
            selected={selected.has(item.id)}
            people={presence.get(item.id) ?? NOBODY}
            onSelectChange={(checked) => onSelectChange([item.id], checked)}
          />
        ))}
      </ul>
    </div>
  );
};
