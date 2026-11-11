import type { DefinitionLens, FieldDefinition, FieldLens } from '@shapio/schema';
import { ITEM_ID_FIELD, ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import type { ComponentLookup } from '../itemIds.js';
import { COMPONENT_KEY } from '../validator/index.js';

/**
 * The IDs of the component instances a write sent (plan item-ids), for its response: the body's component
 * fields, in the caller's own API IDs, each instance as `{ id }` (dynamic-zone items with their `__component`)
 * and the component fields the caller sent inside it, nested the same way. Only what the body named: never a
 * field or an item the caller did not send. A caller that cannot read the entry learns the IDs of the items it
 * wrote, so its next write can send them back.
 *
 *   { "cards": [{ "id": "…" }, { "id": "…", "chips": [{ "id": "…" }] }], "hero": { "id": "…" } }
 */
export type ItemIdNode = { [key: string]: string | ItemIdNode | ItemIdNode[] };
export type ItemIdTree = Record<string, ItemIdNode | ItemIdNode[]>;

/** One level of the body: how a key it sends names a stored field, and the levels inside its instances. */
type Level = (key: string) =>
  | {
      fieldId: string;
      kind: 'single' | 'list' | 'zone';
      inside: (item: Readonly<Record<string, unknown>>) => Level | undefined;
    }
  | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const kindOf = (field: FieldDefinition): 'single' | 'list' | 'zone' | undefined =>
  field.type === 'component'
    ? field.settings.repeatable
      ? 'list'
      : 'single'
    : field.type === 'dynamiczone'
      ? 'zone'
      : undefined;

/** Today's API IDs (a body without a schema version). */
export const todayLevel =
  (
    fields: readonly FieldDefinition[],
    componentOf: ComponentLookup,
    componentByApiKey: (apiKey: string) => string | undefined,
  ): Level =>
  (key) => {
    const field = fields.find((candidate) => candidate.apiKey === key);
    const kind = field ? kindOf(field) : undefined;
    if (!field || !kind) {
      return undefined;
    }
    return {
      fieldId: field.id,
      kind,
      inside: (item) => {
        const componentId =
          field.type === 'component'
            ? field.settings.component
            : typeof item[COMPONENT_KEY] === 'string'
              ? componentByApiKey(item[COMPONENT_KEY])
              : undefined;
        const component = componentId ? componentOf(componentId) : undefined;
        return component ? todayLevel(component.fields, componentOf, componentByApiKey) : undefined;
      },
    };
  };

/** The client's API IDs, through its schema version's lens. */
export const lensLevel =
  (lens: DefinitionLens): Level =>
  (key) => {
    const field: FieldLens | undefined = lens.fields.find((candidate) => candidate.apiKey === key);
    if (!field || field.kind === 'null') {
      return undefined;
    }
    const kind = kindOf(field.client);
    if (!kind) {
      return undefined;
    }
    return {
      fieldId: field.fieldId,
      kind,
      inside: (item) => {
        const nested =
          field.client.type === 'component'
            ? field.nested?.components.get(field.client.settings.component)
            : [...(field.nested?.components.values() ?? [])].find(
                (candidate) => candidate?.apiKey === item[COMPONENT_KEY],
              );
        return nested ? lensLevel(nested) : undefined;
      },
    };
  };

const nodeOf = (
  sent: Readonly<Record<string, unknown>>,
  written: unknown,
  level: Level | undefined,
  zone: boolean,
): ItemIdNode | undefined => {
  if (!isRecord(written) || typeof written[ITEM_ID_KEY] !== 'string') {
    return undefined;
  }
  return {
    [ITEM_ID_FIELD]: written[ITEM_ID_KEY],
    ...(zone && typeof sent[COMPONENT_KEY] === 'string' ? { [COMPONENT_KEY]: sent[COMPONENT_KEY] } : {}),
    ...(level ? treeOf(sent, written, level) : {}),
  };
};

function treeOf(
  sent: Readonly<Record<string, unknown>>,
  written: Readonly<ContentData>,
  level: Level,
): ItemIdTree {
  const tree: ItemIdTree = {};
  for (const [key, value] of Object.entries(sent)) {
    const field = level(key);
    if (!field) {
      continue;
    }
    const stored = written[field.fieldId];
    if (field.kind === 'single') {
      const node = isRecord(value) ? nodeOf(value, stored, field.inside(value), false) : undefined;
      if (node) {
        tree[key] = node;
      }
    } else if (Array.isArray(value) && Array.isArray(stored)) {
      tree[key] = value.flatMap((item: unknown, index) => {
        const node = isRecord(item)
          ? nodeOf(item, stored[index], field.inside(item), field.kind === 'zone')
          : undefined;
        return node ? [node] : [];
      });
    }
  }
  return tree;
}

/** The IDs of what `sent` (a write body, at `level`'s names) wrote, read from `written` (storage form). */
export const itemIdTreeOf = (
  sent: Readonly<Record<string, unknown>>,
  written: Readonly<ContentData>,
  level: Level,
): ItemIdTree => treeOf(sent, written, level);
