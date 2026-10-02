import type { AdminEntryListItem, PresencePerson } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { labelOf } from '@/fields/helpers/titles';
import type { RowContext } from '../Row';
import { SelectAll } from '../SelectAll';
import { Card } from './Card';

type CardsProps = {
  context: RowContext;
  cover: FieldDefinition;
  items: readonly AdminEntryListItem[];
  selected: ReadonlySet<string>;
  presence: ReadonlyMap<string, readonly PresencePerson[]>;
  onSelectChange: (ids: string[], checked: boolean) => void;
};

const NOBODY: readonly PresencePerson[] = [];

/** A place's entries as cover tiles (models with a cover field). */
export const Cards = ({ context, cover, items, selected, presence, onSelectChange }: CardsProps) => {
  const { t } = useTranslation();
  return (
    <div>
      <SelectAll
        ids={items.map((item) => item.id)}
        selected={selected}
        onSelectChange={onSelectChange}
        className="px-4 pt-4"
      />
      <ul
        aria-label={t('place.view.cardsLabel', { place: context.model.label })}
        className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        {items.map((item) => (
          <Card
            key={item.id}
            context={context}
            cover={cover}
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
