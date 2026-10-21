import type { FieldDefinition } from '@shapio/schema';
import type { RawBuilder } from 'kysely';
import { AppError } from '../../helpers/appError.js';
import type { Principal, RowFilter } from '../../permissions/types.js';
import type { HeadSource, LocaleScope } from './compile.js';

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
  | {
      kind: 'condition';
      target: FilterTarget;
      operator: FilterOperator;
      value: unknown;
      /**
       * `$null`/`$notNull` on a relation or media field: the targets the read shows (`visibleReferences.ts`), so
       * a value whose targets are all hidden counts as null. Absent: the stored value decides.
       */
      shownTargets?: ShownTargets;
    };

/**
 * Which stored references a read shows: relation targets with a head in the read's source and locale chain
 * that their model's row filter lets through, live media assets, or none at all (a target model that is
 * gone). A relation to a model with kinds lists every readable member of its family (plan
 * polymorphic-types), each with its own row filter.
 */
export type ShownTargets =
  | {
      kind: 'relation';
      siteId: string;
      /**
       * The readable models whose heads count, each with its row filter; `locales` per member for a target
       * whose members differ in localization (an interface or any entry, plan interfaces), else `locales`.
       */
      members: ReadonlyArray<{ modelId: string; rowFilter: RowFilter | null; locales?: LocaleScope }>;
      source: HeadSource;
      locales: LocaleScope;
      actor: Principal;
    }
  | { kind: 'media'; siteId: string }
  | { kind: 'none' };

export type SortTerm = { target: FilterTarget; direction: 'asc' | 'desc' };

/** One compiled ORDER BY term: the sort expression over the head `h`, its direction and whether it may be null. */
export type OrderTerm = { expression: RawBuilder<unknown>; direction: 'asc' | 'desc'; nullable: boolean };

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
  /**
   * `populate=*` was asked for. On a model read it is already expanded into `populate`; an interface read
   * (plan interfaces, Q-c) expands it per member, to each row's own relation fields.
   */
  populateAll?: boolean;
  locale: string | undefined;
  snapshot: number | undefined;
  /** Delivery and preview only: how rich-text values are returned (`?richText=`); undefined on admin reads. */
  richText?: RichTextMode;
  /** Delivery and preview only: SEO fields as stored (`raw`, the default) or with the site's defaults (`?seo=`). */
  seo?: SeoMode;
  /** Delivery only: `?publicationState=draft` reads draft heads (if the caller may; plan drafts-mode). */
  publicationState?: PublicationState;
  /** Admin list only: entries whose draft in the served locale has this status. */
  status?: EntryListStatus;
  /** Admin list only: entries created by this admin user. */
  author?: string;
  /**
   * `filters[__model]`: the kinds (model IDs) of the route's family to read (plan polymorphic-types). Narrows
   * the read's members; absent: every kind.
   */
  kinds?: readonly string[];
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
/** Which heads a delivery read serves (`?publicationState=`, GraphQL's `publicationState`). */
export const PUBLICATION_STATES = ['published', 'draft'] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

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
