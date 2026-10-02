import type { ContentFilterOperator } from '@shapio/client';

/** Page sizes offered by content lists (the API allows up to 100). */
export const CONTENT_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_CONTENT_PAGE_SIZE = 25;

export const CONTENT_FILTER_OPERATORS = [
  '$eq',
  '$ne',
  '$in',
  '$nin',
  '$lt',
  '$lte',
  '$gt',
  '$gte',
  '$contains',
  '$notContains',
  '$containsi',
  '$startsWith',
  '$endsWith',
  '$null',
  '$notNull',
] as const satisfies readonly ContentFilterOperator[];

/** Debounce before an autosave (ms after the last change). */
export const AUTOSAVE_DELAY_MS = 1500;
