import type { DataType, DataTypeSettings, JsonValue, MEDIA_KINDS } from '@shapio/schema';
import type { ComponentType } from 'react';

/**
 * The contract between the Shapio admin and a field editor (brief §6, ADR 0009). Built-in editors and
 * custom editors loaded at runtime from a project's `extensions/editors/*.js` receive exactly these props.
 *
 * An editor gets the field's value and metadata plus a small, explicit context. It never gets a network
 * client, a session, tokens or secrets: everything it can do goes through `onChange` and the context
 * functions. The server validates the value the same way whatever editor produced it.
 *
 * Bump EDITOR_CONTRACT_VERSION on any breaking change. The admin refuses editors built for another
 * version and falls back to the field's built-in editor.
 */
export const EDITOR_CONTRACT_VERSION = 1;

/** The rich-text envelope stored for `richtext` fields (ADR 0003). `doc` is ProseMirror JSON. */
export type RichTextValue = {
  format: 'shapio-richtext';
  version: number;
  doc: { type: 'doc'; content?: JsonValue[] };
};

/** A component value: its fields keyed by API key. */
export type ComponentValue = { [apiKey: string]: unknown };

/** A dynamic-zone item: a component value plus the component's API key in `__component`. */
export type DynamicZoneItem = ComponentValue & { __component: string };

/**
 * The value type of each data type, as the admin API reads and writes it. Dates and times are canonical
 * UTC ISO-8601 text; decimals and big integers are strings so no precision is lost; relations and media
 * are IDs (lists of IDs when the field holds several).
 */
export type EditorValueMap = {
  string: string;
  text: string;
  code: string;
  richtext: RichTextValue;
  number: number;
  integer: number;
  decimal: string;
  biginteger: string;
  boolean: boolean;
  date: string;
  datetime: string;
  time: string;
  enum: string | string[];
  json: JsonValue;
  slug: string;
  email: string;
  url: string;
  uid: string;
  media: string | string[];
  relation: string | string[];
  component: ComponentValue | ComponentValue[];
  dynamiczone: DynamicZoneItem[];
};

export type EditorValue<T extends DataType = DataType> = EditorValueMap[T];

/** The field being edited, from the active model definition. */
export type EditorField<T extends DataType = DataType> = {
  /** Stable field ID (never changes when the field is renamed). */
  id: string;
  apiKey: string;
  label: string;
  description: string | undefined;
  type: T;
  required: boolean;
  /** True when the value is per locale; false when it is shared by every locale of the entry. */
  localized: boolean;
  /** Type settings: validation rules (min, max, pattern...), enum values, relation target... */
  settings: DataTypeSettings[T];
  /** This editor's options, as configured on the field in the model builder. */
  options: Readonly<Record<string, JsonValue>>;
};

/** The model (or component) the field belongs to. */
export type EditorModel = {
  id: string;
  apiKey: string;
  label: string;
  kind: 'collection' | 'singleton' | 'component';
  localized: boolean;
};

export type MediaKind = (typeof MEDIA_KINDS)[number];

export type MediaPickOptions = {
  multiple?: boolean;
  /** Restrict the picker to these kinds of files. */
  allowedKinds?: readonly MediaKind[];
};

/** What the media picker hands back: enough to preview and reference an asset, never storage details. */
export type PickedMedia = {
  id: string;
  filename: string;
  mimeType: string;
  /** For previews in the admin only. Private assets have expiring URLs; store the `id`, never the URL. */
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

/** The limited capabilities an editor may use. */
export type EditorContext = {
  /** The content locale being edited, or null when the model is not localized. */
  locale: string | null;
  /** The entry being edited, or null for an entry that is not created yet. */
  entryId: string | null;
  /** The admin's interface language (e.g. `en`), for editors that ship their own strings. */
  uiLanguage: string;
  /** Opens the media library; resolves with the chosen assets, or null when the person cancels. */
  pickMedia: (options?: MediaPickOptions) => Promise<PickedMedia[] | null>;
  /** Translates one of the admin's own keys (e.g. `common.remove`); unknown keys return `fallback`. */
  translate: (key: string, fallback: string, values?: Readonly<Record<string, string | number>>) => string;
};

export type FieldValidationState = {
  /** Server and client validation messages for this value, already translated. */
  errors: readonly string[];
  invalid: boolean;
};

export type FieldEditorProps<T extends DataType = DataType> = {
  /** The DOM id the field's label points at: put it on the editor's main focusable element. */
  inputId: string;
  /** The DOM id of the field's visible label: use `aria-labelledby` on group controls (radio groups...). */
  labelId: string;
  /** Ids of the description and error elements: pass to `aria-describedby`. */
  describedBy: string | undefined;
  /** The current value; null when the field is empty. */
  value: EditorValue<T> | null;
  /** Report a new value. Pass null to clear the field. */
  onChange: (value: EditorValue<T> | null) => void;
  /** Call when the editor loses focus (client-side checks run then). */
  onBlur: () => void;
  validation: FieldValidationState;
  /** Shown but not editable (e.g. a field the person may not change). Keep the value selectable. */
  readOnly: boolean;
  /** Temporarily unavailable (e.g. while the entry is being saved or reloaded). */
  disabled: boolean;
  field: EditorField<T>;
  model: EditorModel;
  context: EditorContext;
};

/** A field editor: what a module in `extensions/editors/` exports (see `defineEditor`). */
export type EditorDefinition<T extends DataType = DataType> = {
  /** Namespaced ID referenced from field definitions, e.g. `acme.starRating` (letters, digits, `_`, `-`). */
  id: string;
  /** The contract version the editor was built against (set by `defineEditor`). */
  contractVersion: number;
  /** Data types the editor can edit. */
  dataTypes: readonly T[];
  component: ComponentType<FieldEditorProps<T>>;
};
