import type { ModelDefinition } from '@shapio/schema';
import type { ListFilter } from '../../helpers/filterOperators';
import type { ContentSchema } from '../../hooks/useContentSchema';
import { FilterChip } from '../FilterChip';
import { useFilterLabel } from '../hooks/useFilterLabel';

type ActiveFilterProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  filter: ListFilter;
  onRemove: () => void;
};

/** One applied filter as a chip: "Title starts with Co ×". */
export const ActiveFilter = ({ schema, model, filter, onRemove }: ActiveFilterProps) => {
  const { subject, condition, value, text } = useFilterLabel(schema, model, filter);
  return (
    <FilterChip label={text} onRemove={onRemove}>
      <span className="text-muted-foreground">
        {subject} {condition}
      </span>
      {value ? ` ${value}` : null}
    </FilterChip>
  );
};
