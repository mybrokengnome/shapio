import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { useCallback } from 'react';
import { useCanvasHandles } from '@/fields/form/canvasHandles';
import { useEntryFormStore, useFieldsEnvironment } from '@/fields/form/context';
import { newComponentItem } from '@/fields/helpers/formValues';
import { toList, type ItemValues } from '@/fields/helpers/values';
import { allowedComponentsOf } from '@/fields/hooks/useAllowedComponents';
import type { BlockType } from '@/fields/RichTextField/canvas/blocks';
import { reportError } from '@/helpers/reportError';

export type Edge = 'start' | 'end';

/** What a canvas field can take at its start or end. */
export type FieldInsertions =
  | { kind: 'richText'; field: FieldDefinition }
  | { kind: 'components'; field: FieldDefinition; components: ComponentDefinition[] }
  | { kind: 'files'; field: FieldDefinition }
  | { kind: 'none'; field: FieldDefinition };

const listMax = (field: FieldDefinition) =>
  field.type === 'dynamiczone' || field.type === 'component' || field.type === 'media'
    ? 'max' in field.settings
      ? field.settings.max
      : undefined
    : undefined;

/**
 * The canvas's boundary inserters: what each field can store at its start or end (rich-text blocks,
 * allowed components, files), and doing it, through the field's registered editor (rich text) or the value
 * itself (lists). A full list offers nothing.
 */
export const useCanvasInsertions = () => {
  const store = useEntryFormStore();
  const handles = useCanvasHandles();
  const { components, pickMedia, readOnly, disabled } = useFieldsEnvironment();

  const insertionsOf = useCallback(
    (field: FieldDefinition): FieldInsertions => {
      if (readOnly || disabled) {
        return { kind: 'none', field };
      }
      const count = toList(store.getState().values[field.apiKey]).length;
      const max = listMax(field);
      const full = max !== undefined && count >= max;
      if (field.type === 'richtext') {
        return { kind: 'richText', field };
      }
      if ((field.type === 'dynamiczone' || field.type === 'component') && !full) {
        return { kind: 'components', field, components: allowedComponentsOf(field, components) };
      }
      if (field.type === 'media' && !full) {
        return { kind: 'files', field };
      }
      return { kind: 'none', field };
    },
    [store, components, readOnly, disabled],
  );

  const putInList = useCallback(
    (field: FieldDefinition, edge: Edge, added: unknown[]) => {
      const current = toList(store.getState().values[field.apiKey]);
      store
        .getState()
        .setValue(field.apiKey, edge === 'start' ? [...added, ...current] : [...current, ...added]);
    },
    [store],
  );

  const insertBlock = useCallback(
    (field: FieldDefinition, type: BlockType, edge: Edge) =>
      void handles?.get(`/${field.apiKey}`)?.insertBlock(type, edge),
    [handles],
  );

  const insertComponent = useCallback(
    (field: FieldDefinition, component: ComponentDefinition, edge: Edge) => {
      const item: ItemValues = newComponentItem(component, field.type === 'dynamiczone');
      putInList(field, edge, [item]);
    },
    [putInList],
  );

  const insertFiles = useCallback(
    async (field: FieldDefinition, edge: Edge) => {
      try {
        const allowedKinds = field.type === 'media' ? field.settings.allowedKinds : undefined;
        const picked = await pickMedia({ multiple: true, ...(allowedKinds ? { allowedKinds } : {}) });
        const current = toList<string>(store.getState().values[field.apiKey]);
        const added = (picked ?? []).map((asset) => asset.id).filter((id) => !current.includes(id));
        if (added.length > 0) {
          putInList(field, edge, added);
        }
      } catch (error) {
        reportError(error, 'adding files to the canvas');
      }
    },
    [pickMedia, putInList, store],
  );

  return { insertionsOf, insertBlock, insertComponent, insertFiles };
};
