import type { DataType, JsonValue, ModelKind, RichTextDocument } from '@shapio/schema';

/**
 * The intermediate "import model" every source adapter (WordPress WXR, Strapi export) produces. The planner
 * turns its definitions into schema files and `import-map.json`; the mapper turns its media and entries into
 * uploads, drafts and change sets. Definitions, fields and entries are addressed by source keys, never by
 * Shapio IDs or API IDs: the planner assigns IDs, and the person may rename API IDs before applying.
 */

export type PlannedField = {
  /** Unique within its definition; how entries address the field. */
  key: string;
  apiKey: string;
  label: string;
  type: DataType;
  localized?: boolean;
  public?: boolean;
  unique?: boolean;
  sortable?: boolean;
  settings?: Record<string, JsonValue>;
  /** `relation`: the target definition's key (replaced by its ID when planned). */
  target?: string;
  /** `component`: the component definition's key. */
  component?: string;
  /** `dynamiczone`: the component definitions' keys. */
  components?: string[];
  /** `slug`: the key of the field the slug is derived from. */
  slugSource?: string;
};

export type PlannedDefinition = {
  key: string;
  kind: ModelKind | 'component';
  apiKey: string;
  pluralApiKey?: string;
  label: string;
  description?: string;
  localized?: boolean;
  category?: string;
  /** Key of the field that labels entries in lists and pickers. */
  titleField?: string;
  fields: PlannedField[];
};

/** Looks up what the mapper created so far, by source ID. */
export type ValueResolver = {
  media: (sourceId: string) => string | undefined;
  entry: (sourceId: string) => string | undefined;
};

export type ConversionWarning = { code: string; detail: string };

export type RichTextConversion = { document: RichTextDocument; warnings: ConversionWarning[] };

export type SourceFields = Record<string, SourceValue>;

/** A field value as the source holds it; references are resolved when the entry is written. */
export type SourceValue =
  | { kind: 'scalar'; value: JsonValue }
  | { kind: 'entries'; sourceIds: string[]; many: boolean }
  | { kind: 'media'; sourceIds: string[]; many: boolean }
  | { kind: 'richtext'; convert: (resolver: ValueResolver) => RichTextConversion }
  | { kind: 'component'; items: SourceFields[]; many: boolean }
  | { kind: 'zone'; items: Array<{ component: string; fields: SourceFields }> };

export type ImportEntryLocale = {
  /** Null for models that are not localized (the instance's default locale). */
  locale: string | null;
  fields: SourceFields;
  /** Published at the source: becomes a publish item in the change set. Drafts stay drafts. */
  published: boolean;
};

export type ImportEntry = {
  sourceId: string;
  definition: string;
  /** For progress and error messages. */
  title: string;
  locales: ImportEntryLocale[];
};

export type ImportMedia = {
  sourceId: string;
  filename: string;
  /** Downloaded when there is no local copy. */
  url?: string;
  /** A local file (an extracted export, or `--media-dir`). */
  path?: string;
  mimeType?: string;
  alt?: string;
  caption?: string;
};

export type ImportSourceKind = 'wordpress' | 'strapi';

export type ImportSource = {
  kind: ImportSourceKind;
  definitions: PlannedDefinition[];
  media: ImportMedia[];
  entries: ImportEntry[];
  /** What the adapter skipped or changed, for the plan output (one line each). */
  notes: string[];
};
