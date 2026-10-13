import type { ModelDefinition } from '@shapio/schema';
import { useContentCounts } from '@/api/contentCounts';

/**
 * How many entries the place has, its kinds' included (its list shows them all; the counts endpoint counts a
 * type's family). An unfiltered page of the list knows its live total, so it wins; the counts endpoint
 * (cached up to 60s) covers a filtered list, other tabs and the first paint.
 */
export const usePlaceCount = (model: ModelDefinition, unfilteredTotal: number | undefined) => {
  const counts = useContentCounts();
  return { count: unfilteredTotal ?? counts?.get(model.id) };
};
