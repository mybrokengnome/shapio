import type { ContentFilter, ContentListQuery } from './contentTypes.js';

/**
 * Serialises a content list query into the bracket querystring the content compiler parses
 * (`filters[title][$eq]=A&sort=title:asc&page=2`). Lists repeat the key (`filters[id][$in]=a&filters[id][$in]=b`).
 */
const appendFilter = (params: URLSearchParams, prefix: string, value: unknown) => {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => {
      if (typeof item === 'object' && item !== null) {
        appendFilter(params, `${prefix}[${index}]`, item);
      } else {
        params.append(prefix, String(item));
      }
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as ContentFilter)) {
      appendFilter(params, `${prefix}[${key}]`, child);
    }
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    params.append(prefix, String(value));
  }
};

export const toContentQueryString = (query: ContentListQuery = {}): string => {
  const params = new URLSearchParams();
  if (query.filters) {
    appendFilter(params, 'filters', query.filters);
  }
  for (const term of query.sort ?? []) {
    params.append('sort', `${term.field}:${term.direction}`);
  }
  if (query.page !== undefined) {
    params.set('page', String(query.page));
  }
  if (query.pageSize !== undefined) {
    params.set('pageSize', String(query.pageSize));
  }
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.locale) {
    params.set('locale', query.locale);
  }
  for (const field of query.fields ?? []) {
    params.append('fields', field);
  }
  for (const path of query.populate ?? []) {
    params.append('populate', path);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.author) {
    params.set('author', query.author);
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
};
