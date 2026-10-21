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
  /**
   * The entry's own model (its singular API ID). A type's list holds its kinds' entries too, so a row may
   * belong to a kind of the model the list was read for.
   */
  model: string;
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
 * A filter tree, serialized with brackets: `{ title: { $eq: 'A' } }` → `filters[title][$eq]=A`. Field keys are
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

/**
 * Moves an entry to another kind of its family (any member, the root included). Values of fields the target
 * lacks are dropped, so a change that drops any must acknowledge it; `expectedVersion` is the draft version
 * the editor saw, of `locale`'s draft (the default locale's when absent).
 */
export type ChangeEntryKindInput = {
  /** The target kind's API ID (singular). */
  targetModelKey: string;
  expectedVersion: number;
  locale?: string;
  /** Required on a change that drops fields; optional on a dry run. */
  acknowledgeDroppedFields?: true;
};

/** A field whose values a kind change drops (the source has it, the target doesn't). */
export type DroppedField = { id: string; apiKey: string; label: string };

/**
 * A kind change's answer: the fields whose values it drops and the kind the entry becomes; `entry` is the
 * entry under its new kind (absent on a dry run, `?dryRun=1`).
 */
export type EntryKindChange = {
  droppedFields: DroppedField[];
  target: { modelId: string; modelKey: string; routeKey: string };
  entry?: AdminEntry;
};

/** Publish or unpublish these locales atomically (the request's default locale when omitted). */
export type EntryLocalesInput = { locales?: string[] };

/**
 * Publish these locales, optionally guarded by the draft version(s) you saw (409 CONTENT_VERSION_CONFLICT when
 * one moved): `expectedVersion` for a publish of one locale, `expectedVersions` (per locale) for several.
 */
export type EntryPublishInput = EntryLocalesInput & {
  expectedVersion?: number;
  expectedVersions?: Record<string, number>;
};

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

/** One live period of an entry's locale: who published it and how, and whether it is still live. */
export type EntryPublication = {
  /** The revision that went live. */
  revisionId: string;
  locale: string;
  publishedAt: string;
  publishedBy: string | null;
  /** How it went live when not by a plain Publish: on schedule, or with a change set (`changeSetTitle`). */
  via: 'schedule' | 'changeSet' | null;
  changeSetTitle: string | null;
  live: boolean;
  /** Set when it stopped being live without another publication of the locale replacing it. */
  unpublishedAt: string | null;
  unpublishedBy: string | null;
};

/** An entry's history: revisions with who made them, and its publications (both newest first). */
export type EntryHistory = {
  items: Array<RevisionSummary & { authorName: string | null }>;
  publications: EntryPublication[];
};

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

/** An admin color theme a project declares in `shapio.config` (its CSS is served as `themes.css`). */
export type ExtensionTheme = {
  key: string;
  name: string;
  description?: string;
  /** The variants it defines; one means it ignores the light/dark setting. */
  variants: Array<'light' | 'dark'>;
};

export type ExtensionThemeList = { items: ExtensionTheme[] };

/**
 * `GET /api/admin/content-targets`: what a relation field to an interface or to any entry may point at
 * (plan interfaces). Keyed by the relation field (top level or inside a component; field IDs are global): the
 * server resolves its target and the models the caller may read.
 */
export type ContentTargetsQuery = {
  /** The relation field's stable ID. */
  field: string;
  /** Narrow to these models (singular API IDs); default every readable one. Ignored with `ids`. */
  types?: readonly string[];
  /** Searched on each model's own title field; models whose title the caller may not search are skipped. */
  q?: string;
  page?: number;
  pageSize?: number;
  locale?: string;
  /**
   * Exactly these entries (at most 100), whatever their model, among the readable ones: labels a stored value.
   * `q`, `types` and paging are ignored; `total` is the number of items returned.
   */
  ids?: readonly string[];
};

/** What the relation targets: its kind, and the label to show ("Featurable", "Any entry"; null for any). */
export type ContentTargetKind = { kind: 'model' | 'interface' | 'any'; label: string | null };

/** A model the field may point at that the caller may read: the type filter's choices. */
export type ContentTargetMember = { apiKey: string; label: string };

export type ContentTargetItem = {
  id: string;
  /** The entry's model (singular API ID). */
  model: string;
  /** The entry's title in its model's own title field; null when it has none or the caller may not read it. */
  title: string | null;
  status: EntryStatus;
  locale: string;
  updatedAt: string;
};

export type ContentTargets = {
  target: ContentTargetKind;
  members: ContentTargetMember[];
  items: ContentTargetItem[];
  total: number;
};
