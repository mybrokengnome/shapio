import type { JsonValue } from '../types/json.js';

export const CHANGE_KINDS = [
  'definition.added',
  'definition.removed',
  'definition.apiKey',
  'definition.pluralApiKey',
  'definition.metadata',
  'model.kind',
  'model.localized',
  'model.draftAndPublish',
  'model.extends',
  'model.implements',
  'field.added',
  'field.removed',
  'field.order',
  'field.apiKey',
  'field.metadata',
  'field.editor',
  'field.type',
  'field.required',
  'field.localized',
  'field.public',
  'field.deprecated',
  'field.unique',
  'field.filterable',
  'field.sortable',
  'field.settings',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * One difference between two versions of a definition. `property` names the changed property for
 * `*.metadata` (`label`, `description`, ...) and `field.settings` (the settings key); `from`/`to` hold the
 * old and new values (absent when the side does not exist). `model.implements` is one change per interface:
 * `property` is the interface's ID, `to` is that ID when the model starts implementing it (`from` null) and
 * `from` is that ID when it stops (`to` null).
 */
export type SchemaChange = {
  kind: ChangeKind;
  definitionId: string;
  fieldId?: string;
  property?: string;
  from?: JsonValue;
  to?: JsonValue;
};
