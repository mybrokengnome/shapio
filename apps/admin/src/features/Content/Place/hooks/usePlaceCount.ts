import type { ModelDefinition } from '@shapio/schema';
import { useContentCounts } from '@/api/contentCounts';

/**
 * How many entries the place has. An unfiltered page of the list knows its live total, so it wins; the
 * counts endpoint (cached up to 60s) covers a filtered list, other tabs and the first paint.
 */
export const usePlaceCount = (model: ModelDefinition, unfilteredTotal: number | undefined) => {
  const counts = useContentCounts();
  return { count: unfilteredTotal ?? counts?.get(model.id) };
};
