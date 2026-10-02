/**
 * Admin content API shapes (package E, `apps/api/src/routes/admin/content/**` and
 * `routes/schemas/content.ts`). Entry `data` is keyed by API keys; its shape is the model's, known only at
 * runtime. Dates are ISO-8601 strings.
 */

/** `modified`: published, and the draft has changed since (or holds autosaved work). */
export type EntryStatus = 'draft' | 'published' | 'modified';

/** Field values keyed by API key. Admin reads return media fields as asset views; writes take asset IDs. */
export type EntryData = Record<string, unknown>;

export type EntryLocaleState = {
  locale: string;
  /** The draft version: send it back as `expectedVersion` when saving this locale. */
  version: number;
  status: EntryStatus;
  publishedAt: string | null;
  /** The published version's shared (non-localized) fields are older than the draft's (ADR 0004). */
  sharedOutdated: boolean;
};

/** One entry's draft in one locale, with every locale's status. */
export type AdminEntry = {
  id: string;
  /** The model's API key. */
  model: string;
  locale: string;
  version: number;
  revisionId: string;
  status: EntryStatus;
  /** Saved without full validation (autosave or duplicate): Save or Publish validates it. */
  autosaved: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  data: EntryData;
  /** Locales that have a draft of this entry. */
  locales: EntryLocaleState[];
  /** Other published locales whose live shared values are older than their drafts. */
  sharedOutdatedLocales: string[];
};

/** The admin who created an entry (null for entries created by API tokens, app users or imports). */
export type EntryAuthor = { id: string; name: string };

/** One locale's status of a list item (localized models). */
export type EntryLocaleStatus = { locale: string; status: EntryStatus };

export type AdminEntryListItem = {
  id: string;
  locale: string;
  version: number;
  status: EntryStatus;
  autosaved: boolean;
  createdAt: string;
  updatedAt: string;
  data: EntryData;
  author: EntryAuthor | null;
  /** Localized models only: every locale the entry has a version in, with its status. */
  locales?: EntryLocaleStatus[];
};

export type ContentPagination = { page: number; pageSize: number; total: number; pageCount: number };

export type AdminEntryPage = {
  items: AdminEntryListItem[];
  pagination: ContentPagination;
  /** The locale the list was read in. */
  locale: string;
};

/** Operators of the content query compiler (`apps/api/src/content/compiler/types.ts`). */
export type ContentFilterOperator =
  | '$eq'
  | '$ne'
  | '$in'
  | '$nin'
  | '$lt'
  | '$lte'
  | '$gt'
  | '$gte'
  | '$contains'
  | '$notContains'
  | '$containsi'
  | '$startsWith'
  | '$endsWith'
  | '$null'
  | '$notNull';

/** A scalar operand; `$in`/`$nin` take a list, `$null`/`$notNull` take `true`. */
export type ContentFilterValue = string | number | boolean | ReadonlyArray<string | number | boolean>;

/**
 * A filter tree, serialised with brackets: `{ title: { $eq: 'A' } }` → `filters[title][$eq]=A`. Field keys are
 * API keys (or `id`, `createdAt`, `updatedAt`); `$and`/`$or` take lists of trees, `$not` one tree.
 */
export type ContentFilter = {
  [key: string]:
    | Partial<Record<ContentFilterOperator, ContentFilterValue>>
    | ContentFilterValue
    | ContentFilter
    | readonly ContentFilter[];
};

export type ContentSort = { field: string; direction: 'asc' | 'desc' };

export type ContentListQuery = {
  filters?: ContentFilter;
  sort?: readonly ContentSort[];
  page?: number;
  pageSize?: number;
  /** Free-text search over the model's title field. */
  q?: string;
  locale?: string;
  /** Top-level fields to return (API keys); all readable fields when absent. */
  fields?: readonly string[];
  /** Relation paths to expand, e.g. `author` or `author.company`. */
  populate?: readonly string[];
  /** Admin list only: entries in this status (in the locale the list is read in). */
  status?: EntryStatus;
  /** Admin list only: entries created by this admin user (ID). */
  author?: string;
};

export type CreateEntryInput = {
  locale?: string;
  data?: EntryData;
  /** Publish the new entry's locale in the same transaction. */
  publish?: boolean;
};

export type UpdateEntryInput = {
  locale?: string;
  /** The draft version the editor loaded; null creates the entry's version in this locale. */
  expectedVersion: number | null;
  /** Changed fields only: a field set to null is cleared, absent fields are kept. */
  data?: EntryData;
  /** Autosave: moves the draft head only (no revision) and does not enforce `required`. */
  autosave?: boolean;
};

/** Publish or unpublish these locales atomically (the request's default locale when omitted). */
export type EntryLocalesInput = { locales?: string[] };

export type RevisionSummary = {
  id: string;
  locale: string;
  /** Why the revision exists: `create`, `save`, `restore`, `localize`, `publish`... */
  reason: string;
  schemaRevisionId: string;
  authorType: string;
  authorId: string | null;
  parentRevisionId: string | null;
  createdAt: string;
};

export type RevisionDetail = RevisionSummary & { data: EntryData };

/** One problem with a content value (422 CONTENT_INVALID `details.issues`). */
export type ContentIssue = { path: string; code: string; message: string };

/** An entry that still points at the one being deleted (409 ENTRY_REFERENCED `details.referrers`). */
export type EntryReferrer = { entryId: string; modelId: string; locale: string; state: string };

/** A custom field editor module the server serves (from the project's `shapio.config` and `extensions/editors`). */
export type EditorManifestItem = {
  /** File name in `extensions/editors/`, e.g. `star-rating.js`. */
  file: string;
  /** Path to import the module from, relative to the server's base URL. */
  path: string;
  /** Content hash: changes whenever the file changes (cache busting). */
  hash: string;
};

export type EditorManifest = { items: EditorManifestItem[] };
