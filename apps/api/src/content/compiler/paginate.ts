import { QUERY_LIMITS } from './types.js';

/** Offset pagination with a hard page-size cap (brief §4: "enforce pagination"). */
export type Pagination = { page: number; pageSize: number; total: number; pageCount: number };

export const toLimitOffset = (page: number, pageSize: number) => {
  const size = Math.min(Math.max(1, pageSize), QUERY_LIMITS.maxPageSize);
  return { limit: size, offset: (Math.max(1, page) - 1) * size };
};

export const paginationMeta = (page: number, pageSize: number, total: number): Pagination => ({
  page,
  pageSize,
  total,
  pageCount: Math.ceil(total / pageSize),
});
