import { COMPONENT_KEY } from '../validator/index.js';

/**
 * Where a definition's fields live inside a document (ValueLocation paths from the planner): the root for
 * a model's own fields, every instance of the component otherwise. The returned objects are references
 * into `data`, so callers mutate a clone.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const ownerContainers = (
  data: Record<string, unknown>,
  path: readonly string[],
  ownerId: string,
): Array<Record<string, unknown>> => {
  let current: Array<Record<string, unknown>> = [data];
  path.forEach((fieldId, index) => {
    const last = index === path.length - 1;
    current = current.flatMap((container) => {
      const value = container[fieldId];
      const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
      return items
        .filter(isRecord)
        .filter((item) => !last || item[COMPONENT_KEY] === undefined || item[COMPONENT_KEY] === ownerId);
    });
  });
  return current;
};
