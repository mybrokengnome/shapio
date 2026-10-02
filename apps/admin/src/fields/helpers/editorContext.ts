import type { EditorContext, EditorField, EditorModel } from '@shapio/editor-sdk';
import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { i18next } from '@/app/i18n';
import type { FieldsEnvironment } from '../form/context';

/** The editor contract's view of a field: metadata only, nothing an editor could use to reach the backend. */
export const toEditorField = (field: FieldDefinition): EditorField => ({
  id: field.id,
  apiKey: field.apiKey,
  label: field.label,
  description: field.description,
  type: field.type,
  required: field.required,
  localized: field.localized,
  settings: field.settings,
  options: field.editor.options,
});

export const toEditorModel = (definition: SchemaDefinition): EditorModel => ({
  id: definition.id,
  apiKey: definition.apiKey,
  label: definition.label,
  kind: definition.kind,
  localized: definition.kind === 'component' ? false : definition.localized,
});

const interpolate = (text: string, values: Readonly<Record<string, string | number>> | undefined) =>
  values
    ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => String(values[name] ?? match))
    : text;

/** Custom editors ask for keys by name at runtime, so this lookup is untyped by design. */
const translateKey = i18next.t.bind(i18next) as unknown as (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

/** The limited capabilities an editor gets (ADR 0009): locale, entry, media picking, translation. */
export const toEditorContext = (environment: FieldsEnvironment): EditorContext => ({
  locale: environment.locale,
  entryId: environment.entryId,
  uiLanguage: i18next.language,
  pickMedia: environment.pickMedia,
  translate: (key, fallback, values) =>
    i18next.exists(key) ? translateKey(key, values) : interpolate(fallback, values),
});
