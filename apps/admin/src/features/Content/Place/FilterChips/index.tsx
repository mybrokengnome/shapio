import type { AdminEntryListItem, EntryStatus } from '@shapio/client';
import type { ModelDefinition, ResolvedModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { relationTargetInfoOf } from '@/fields/helpers/relationTargetLabel';
import { shortId } from '@/fields/helpers/titles';
import { ENTRY_STATUS_LABEL_KEYS } from '../../helpers/entryStatus';
import type { ListFilter } from '../../helpers/filterOperators';
import type { ContentSchema } from '../../hooks/useContentSchema';
import { ActiveFilter } from '../ActiveFilter';
import { AuthorFilter } from '../AuthorFilter';
import { FilterChip } from '../FilterChip';
import { relationFilterFields } from '../helpers/filterLabels';
import { kindFilterChoices } from '../helpers/kindFilter';
import { useAuthorChoices } from '../hooks/useAuthorChoices';
import { KindFilter } from '../KindFilter';
import { RelationFilter } from '../RelationFilter';
import { StatusFilter } from '../StatusFilter';

type FilterChipsProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  filters: readonly ListFilter[];
  status: EntryStatus | undefined;
  author: string | undefined;
  /** The place's type and its kinds when it has some (none otherwise: no Kind filter). */
  kinds: readonly ResolvedModelDefinition[];
  /** The kind the list is narrowed to. */
  kind: ModelDefinition | undefined;
  /** Changes some of the list's filters at once (one URL update). */
  onSearchChange: (changes: FilterChanges) => void;
  /** The page's entries (their authors are offered by "Created by"). */
  items: readonly AdminEntryListItem[] | undefined;
};

export type FilterChanges = {
  filters?: ListFilter[];
  status?: EntryStatus | undefined;
  author?: string | undefined;
  kind?: string | undefined;
};

type ChipProps = { subject: string; value: string; onRemove: () => void };

const Chip = ({ subject, value, onRemove }: ChipProps) => (
  <FilterChip label={`${subject} ${value}`} onRemove={onRemove}>
    <span className="text-muted-foreground">{subject}</span> {value}
  </FilterChip>
);

/**
 * The list's filters as chips: status, "created by" and, for a type with kinds, kind (quick filters), every
 * applied condition (removable), and a dashed chip per relation ("+ Author") that filters by one related
 * entry. Other conditions are added with the Filters button.
 */
export const FilterChips = ({
  schema,
  model,
  filters,
  status,
  author,
  kinds,
  kind,
  onSearchChange,
  items,
}: FilterChipsProps) => {
  const { t } = useTranslation();
  const { choices, meId, nameOf } = useAuthorChoices(items);
  const used = new Set(filters.map((filter) => filter.field));
  const adders = relationFilterFields(model).filter((field) => !used.has(field.apiKey));
  const applied = filters.length + (status ? 1 : 0) + (author ? 1 : 0) + (kind ? 1 : 0);
  const kindChoices = kindFilterChoices(kinds);
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <ul aria-label={t('place.filters.active')} className="flex flex-wrap items-center gap-2">
        {status ? (
          <Chip
            subject={t('place.filters.statusIs')}
            value={t(ENTRY_STATUS_LABEL_KEYS[status])}
            onRemove={() => onSearchChange({ status: undefined })}
          />
        ) : null}
        {kind ? (
          <Chip
            subject={t('place.filters.kindIs')}
            value={kind.label}
            onRemove={() => onSearchChange({ kind: undefined })}
          />
        ) : null}
        {author ? (
          <Chip
            subject={t('place.filters.createdBy')}
            value={nameOf(author) ?? shortId(author)}
            onRemove={() => onSearchChange({ author: undefined })}
          />
        ) : null}
        {filters.map((filter, index) => (
          <ActiveFilter
            key={`${filter.field}-${index}`}
            schema={schema}
            model={model}
            filter={filter}
            onRemove={() => onSearchChange({ filters: filters.filter((_, at) => at !== index) })}
          />
        ))}
        {status ? null : <StatusFilter onPick={(next) => onSearchChange({ status: next })} />}
        {kind || kindChoices.length === 0 ? null : (
          <KindFilter kinds={kindChoices} onPick={(next) => onSearchChange({ kind: next })} />
        )}
        {author ? null : (
          <AuthorFilter choices={choices} meId={meId} onPick={(next) => onSearchChange({ author: next })} />
        )}
        {adders.map((field) =>
          field.type === 'relation' ? (
            <RelationFilter
              key={field.id}
              field={field}
              target={relationTargetInfoOf(field.settings.target, schema.models, schema.index)}
              onPick={(entryId) =>
                onSearchChange({
                  filters: [...filters, { field: field.apiKey, operator: '$eq', value: entryId }],
                })
              }
            />
          ) : null,
        )}
      </ul>
      {applied > 1 ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() =>
            onSearchChange({ filters: [], status: undefined, author: undefined, kind: undefined })
          }
        >
          {t('place.filters.clearChips')}
        </Button>
      ) : null}
    </div>
  );
};
