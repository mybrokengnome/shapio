import type { FieldDefinition } from '@shapio/schema';
import { AppError } from '../../helpers/appError.js';

/** The parsed, allowlisted form of a content query. Nothing in it is raw request text used as SQL. */

export const FILTER_OPERATORS = [
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
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** System attributes every entry has. They are not stored in `data`. */
export const SYSTEM_ATTRIBUTES = ['id', 'createdAt', 'updatedAt'] as const;
export type SystemAttribute = (typeof SYSTEM_ATTRIBUTES)[number];

export type FilterTarget =
  { kind: 'field'; field: FieldDefinition } | { kind: 'system'; name: SystemAttribute };

export type FilterNode =
  | { kind: 'and'; nodes: FilterNode[] }
  | { kind: 'or'; nodes: FilterNode[] }
  | { kind: 'not'; node: FilterNode }
  | { kind: 'condition'; target: FilterTarget; operator: FilterOperator; value: unknown };

export type SortTerm = { target: FilterTarget; direction: 'asc' | 'desc' };

/** Relation fields to expand, with what to expand inside each target. */
export type PopulateTree = ReadonlyMap<string, PopulateTree>;

export type ContentQuery = {
  filter: FilterNode | null;
  /** Free-text search over the model's title field. */
  search: { field: FieldDefinition; text: string } | null;
  sort: SortTerm[];
  page: number;
  pageSize: number;
  /** Top-level fields to return; null = every readable field. */
  fields: FieldDefinition[] | null;
  /** Keyed by relation field ID. */
  populate: PopulateTree;
  locale: string | undefined;
  snapshot: number | undefined;
  /** Delivery and preview only: how rich-text values are returned (`?richText=`); undefined on admin reads. */
  richText?: RichTextMode;
  /** Delivery and preview only: SEO fields as stored (`raw`, the default) or with the site's defaults (`?seo=`). */
  seo?: SeoMode;
  /** Admin list only: entries whose draft in the served locale has this status. */
  status?: EntryListStatus;
  /** Admin list only: entries created by this admin user. */
  author?: string;
};

/**
 * Delivery shapes of a rich-text value (ADR 0003): `json` the stored document `{ format, version, doc }`,
 * `html` `{ format, version, html }` (sanitized HTML rendered from the document), `both` the document plus
 * `html`.
 */
export const RICH_TEXT_MODES = ['json', 'html', 'both'] as const;
export type RichTextMode = (typeof RICH_TEXT_MODES)[number];

/** What a delivery read returns for rich text when the request does not say (`?richText=`). */
export const DEFAULT_RICH_TEXT_MODE: RichTextMode = 'json';

/** `?seo=`: SEO fields as stored, or merged with the site's SEO defaults (plan seo-fields). */
export const SEO_MODES = ['raw', 'resolved'] as const;
export type SeoMode = (typeof SEO_MODES)[number];

export const ENTRY_LIST_STATUSES = ['draft', 'published', 'modified'] as const;
export type EntryListStatus = (typeof ENTRY_LIST_STATUSES)[number];

export const QUERY_LIMITS = {
  maxPageSize: 100,
  defaultPageSize: 25,
  maxConditions: 50,
  maxFilterDepth: 6,
  maxInValues: 100,
  maxValueLength: 1000,
  maxParameters: 200,
  maxPopulateDepth: 3,
  maxSortTerms: 5,
} as const;

/** A malformed or disallowed query: 400 for unknown/invalid, 403 for fields the caller may not use. */
export const queryInvalid = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'INVALID_QUERY', message, details);

export const queryForbidden = (message: string, details?: Record<string, unknown>) =>
  new AppError(403, 'FORBIDDEN_FIELD', message, details);
