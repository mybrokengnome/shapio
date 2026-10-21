import { Type, type Static } from 'typebox';
import { DATA_TYPES, type DataType } from './dataTypes.js';
import type { JsonValue } from './json.js';
import type { DataTypeSettings } from './settings.js';

/**
 * Model, component and interface definitions. All share one table (`models`, with a `kind` discriminator)
 * but have distinct TypeScript types: a component cannot be published, localized or addressed by a route;
 * an interface is a contract of fields that collections and singletons implement, and stores nothing.
 *
 * The `*InputSchema` TypeBox schemas describe what callers send and what schema files contain: IDs and
 * defaulted properties may be omitted. `normalizeDefinition` turns input into the normalized types below,
 * which are what Shapio stores, hashes and diffs.
 */
const closed = { additionalProperties: false } as const;

export const MODEL_KINDS = ['collection', 'singleton'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];
export const DEFINITION_KINDS = [...MODEL_KINDS, 'component', 'interface'] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * How an entry of a model opens: `document` (title typed into the page, blocks in a canvas, properties in
 * the strip and the settings drawer) or `form` (every field inline at its `width`, sections from
 * `display.groups`). Unset means `document`; normalizing drops an explicit `document`.
 */
export const ENTRY_LAYOUTS = ['document', 'form'] as const;
export type EntryLayout = (typeof ENTRY_LAYOUTS)[number];

/**
 * A field's width in a form-layout entry, as a share of the row: rows fill in field order and wrap. Unset
 * means `full`; normalizing drops an explicit `full`.
 */
export const FIELD_WIDTHS = ['full', 'two-thirds', 'half', 'third'] as const;
export type FieldWidth = (typeof FIELD_WIDTHS)[number];

export const MAX_FIELDS_PER_DEFINITION = 500;
/** Most interfaces one model may implement directly. */
export const MAX_IMPLEMENTS = 50;
export const MAX_LABEL_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;

const Label = Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH });
const Description = Type.Optional(Type.String({ maxLength: MAX_DESCRIPTION_LENGTH }));

export const EditorChoiceInputSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  closed,
);

export const FieldInputSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    apiKey: Type.String(),
    label: Label,
    /** Help text shown under the control. */
    description: Description,
    type: Type.Enum(DATA_TYPES),
    required: Type.Optional(Type.Boolean()),
    /** Per-locale value. Ignored (must be false) when the model is not localized. */
    localized: Type.Optional(Type.Boolean()),
    /** Readable by delivery principals wherever the model is readable (ADR 0005). Default true. */
    public: Type.Optional(Type.Boolean()),
    unique: Type.Optional(Type.Boolean()),
    filterable: Type.Optional(Type.Boolean()),
    sortable: Type.Optional(Type.Boolean()),
    /** Hidden from editors and the API; stored values are preserved until an explicit cleanup. */
    deprecated: Type.Optional(Type.Boolean()),
    /** Used for new entries and to backfill existing ones when the field becomes required. */
    defaultValue: Type.Optional(Type.Unknown()),
    /** Type-specific settings, validated against SETTINGS_SCHEMAS[type]. */
    settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    editor: Type.Optional(EditorChoiceInputSchema),
    /**
     * Width in a form-layout entry (`display.layout: 'form'`). Default `full`. Model fields only: the
     * validator refuses it on a component's field.
     */
    width: Type.Optional(Type.Enum(FIELD_WIDTHS)),
  },
  closed,
);

const FieldGroupSchema = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 64 }), label: Label, fieldIds: Type.Array(Type.String()) },
  closed,
);

export const ModelDisplayInputSchema = Type.Object(
  {
    /** How entries open: `document` (default) or `form`. See `ENTRY_LAYOUTS`. */
    layout: Type.Optional(Type.Enum(ENTRY_LAYOUTS)),
    /** Field whose value labels an entry in lists, pickers and relation summaries. */
    titleFieldId: Type.Optional(Type.String()),
    /** Columns of the content list, in order. */
    listFieldIds: Type.Optional(Type.Array(Type.String())),
    defaultSort: Type.Optional(
      Type.Object({ fieldId: Type.String(), direction: Type.Enum(SORT_DIRECTIONS) }, closed),
    ),
    /** Editor layout: named sections of the entry form. */
    groups: Type.Optional(Type.Array(FieldGroupSchema)),
    /** Fields rendered as blocks in the entry document's canvas, in order. Default: see `effectiveLayout`. */
    canvasFieldIds: Type.Optional(Type.Array(Type.String())),
    /** A single image `media` field shown as the cover above the title. Default: see `effectiveLayout`. */
    coverFieldId: Type.Optional(Type.String()),
    /** Properties shown as chips in the document's strip. Default: the first non-empty ones. */
    stripFieldIds: Type.Optional(Type.Array(Type.String())),
  },
  closed,
);

export const ComponentDisplayInputSchema = Type.Object(
  {
    titleFieldId: Type.Optional(Type.String()),
    groups: Type.Optional(Type.Array(FieldGroupSchema)),
  },
  closed,
);

const definitionBase = {
  id: Type.Optional(Type.String()),
  apiKey: Type.String(),
  label: Label,
  description: Description,
  fields: Type.Array(FieldInputSchema, { maxItems: MAX_FIELDS_PER_DEFINITION }),
};

export const ModelDefinitionInputSchema = Type.Object(
  {
    ...definitionBase,
    kind: Type.Enum(MODEL_KINDS),
    /**
     * Collections only: names the list route and query (`/api/content/articles`, `articles(…)`). Optional
     * here so files written before plural API IDs still parse; normalizing fills it on a collection.
     */
    pluralApiKey: Type.Optional(Type.String()),
    localized: Type.Optional(Type.Boolean()),
    /** Entries have separate draft and published states. Default true. */
    draftAndPublish: Type.Optional(Type.Boolean()),
    /**
     * Collections only: the stable ID of the collection this one extends (its parent). The model inherits
     * the parent's fields, locked, and adds its own (plan polymorphic-types).
     */
    extends: Type.Optional(Type.String()),
    /**
     * The stable IDs of the interfaces this collection or singleton implements (plan interfaces). Normalizing
     * sorts them and drops duplicates. A model also implements what its ancestors implement.
     */
    implements: Type.Optional(Type.Array(Type.String(), { maxItems: MAX_IMPLEMENTS })),
    display: Type.Optional(ModelDisplayInputSchema),
  },
  closed,
);

export const ComponentDefinitionInputSchema = Type.Object(
  {
    ...definitionBase,
    kind: Type.Literal('component'),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    icon: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    display: Type.Optional(ComponentDisplayInputSchema),
  },
  closed,
);

export const InterfaceDisplayInputSchema = Type.Object(
  {
    /** The contract field the interface's list searches and pickers show. */
    titleFieldId: Type.Optional(Type.String()),
    defaultSort: Type.Optional(
      Type.Object({ fieldId: Type.String(), direction: Type.Enum(SORT_DIRECTIONS) }, closed),
    ),
  },
  closed,
);

/**
 * An interface (plan interfaces): a name, an API ID, a plural (its list route and query), and a contract of
 * fields every member must have. Contract fields are full fields with stable IDs of their own; editor,
 * width, default value and deprecation mean nothing on them and are refused (`INVALID_INTERFACE_FIELD`).
 */
export const InterfaceDefinitionInputSchema = Type.Object(
  {
    ...definitionBase,
    kind: Type.Literal('interface'),
    /** Names the list route and query (`/api/content/featurables`); normalizing fills it when missing. */
    pluralApiKey: Type.Optional(Type.String()),
    display: Type.Optional(InterfaceDisplayInputSchema),
  },
  closed,
);

export const DefinitionInputSchema = Type.Union([
  ModelDefinitionInputSchema,
  ComponentDefinitionInputSchema,
  InterfaceDefinitionInputSchema,
]);

export type FieldInput = Static<typeof FieldInputSchema>;
export type ModelDefinitionInput = Static<typeof ModelDefinitionInputSchema>;
export type ComponentDefinitionInput = Static<typeof ComponentDefinitionInputSchema>;
export type InterfaceDefinitionInput = Static<typeof InterfaceDefinitionInputSchema>;
export type DefinitionInput = ModelDefinitionInput | ComponentDefinitionInput | InterfaceDefinitionInput;

export type EditorChoice = { id: string; options: Record<string, JsonValue> };

type FieldBase = {
  id: string;
  apiKey: string;
  label: string;
  description?: string;
  required: boolean;
  localized: boolean;
  public: boolean;
  unique: boolean;
  filterable: boolean;
  sortable: boolean;
  deprecated: boolean;
  defaultValue?: JsonValue;
  editor: EditorChoice;
  /** Width in a form-layout entry; absent means `full`. */
  width?: FieldWidth;
};

/** A normalized field. Narrow on `type` to get typed `settings`. */
export type FieldDefinition<T extends DataType = DataType> = {
  [K in T]: FieldBase & { type: K; settings: DataTypeSettings[K] };
}[T];

export type FieldGroup = { id: string; label: string; fieldIds: string[] };

export type ModelDisplay = {
  /** Absent means `document`. */
  layout?: EntryLayout;
  titleFieldId?: string;
  listFieldIds?: string[];
  defaultSort?: { fieldId: string; direction: SortDirection };
  groups?: FieldGroup[];
  canvasFieldIds?: string[];
  coverFieldId?: string;
  stripFieldIds?: string[];
};

export type ComponentDisplay = { titleFieldId?: string; groups?: FieldGroup[] };

export type ModelDefinition = {
  id: string;
  kind: ModelKind;
  apiKey: string;
  /**
   * Present on collections (filled by normalizing), absent on singletons. Read it through `routeKeyOf`,
   * which also covers a stored definition that predates plural API IDs.
   */
  pluralApiKey?: string;
  label: string;
  description?: string;
  localized: boolean;
  draftAndPublish: boolean;
  /**
   * The stable ID of the collection this one extends. The stored definition holds its own fields only;
   * `resolveModelDefinition` adds the inherited ones (ancestors' first).
   */
  extends?: string;
  /**
   * The stable IDs of the interfaces the model implements itself, sorted, without duplicates; absent when
   * none. `DefinitionIndex.interfacesOf` adds the ones inherited from ancestors.
   */
  implements?: string[];
  fields: FieldDefinition[];
  display: ModelDisplay;
};

/** A field as a model sees it after inheritance: `inheritedFrom` names the declaring ancestor's ID. */
export type ResolvedField = FieldDefinition & { inheritedFrom?: string };

/**
 * A model with its effective fields: every ancestor's fields (root first), then its own, and its display
 * merged with its ancestors' (`resolveModelDefinition`). `ancestorIds` is required so code that needs
 * effective fields can demand this type; a stored definition does not satisfy it.
 */
export type ResolvedModelDefinition = Omit<ModelDefinition, 'fields'> & {
  fields: ResolvedField[];
  /** Ancestors' stable IDs, root first; empty for a model that extends nothing. */
  ancestorIds: readonly string[];
};

export type ComponentDefinition = {
  id: string;
  kind: 'component';
  apiKey: string;
  label: string;
  description?: string;
  category?: string;
  icon?: string;
  fields: FieldDefinition[];
  display: ComponentDisplay;
};

export type InterfaceDisplay = {
  titleFieldId?: string;
  defaultSort?: { fieldId: string; direction: SortDirection };
};

/** An interface (plan interfaces): a contract of fields. It has no entries, routes of its own aside. */
export type InterfaceDefinition = {
  id: string;
  kind: 'interface';
  apiKey: string;
  /** Always present (filled by normalizing): the list route and query. */
  pluralApiKey: string;
  label: string;
  description?: string;
  fields: FieldDefinition[];
  display: InterfaceDisplay;
};

/** Any kind. Most schema machinery (diff, file format, registry) works on all of them. */
export type SchemaDefinition = ModelDefinition | ComponentDefinition | InterfaceDefinition;

export const isComponentDefinition = (definition: SchemaDefinition): definition is ComponentDefinition =>
  definition.kind === 'component';

export const isInterfaceDefinition = (definition: SchemaDefinition): definition is InterfaceDefinition =>
  definition.kind === 'interface';

/** A collection or singleton: a definition that has entries. Never a component or an interface. */
export const isModelDefinition = (definition: SchemaDefinition): definition is ModelDefinition =>
  definition.kind === 'collection' || definition.kind === 'singleton';

/** Model, component or interface: which admin area and API path a definition belongs to. */
export const DEFINITION_CATEGORIES = ['model', 'component', 'interface'] as const;
export type DefinitionCategory = (typeof DEFINITION_CATEGORIES)[number];

export const categoryOfKind = (kind: string): DefinitionCategory =>
  kind === 'component' ? 'component' : kind === 'interface' ? 'interface' : 'model';

/** The relation target that accepts an entry of any collection or singleton ("Any entry"). */
export const ANY_TARGET = '*';
