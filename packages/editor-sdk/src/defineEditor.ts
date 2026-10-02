import type { DataType } from '@shapio/schema';
import { EDITOR_CONTRACT_VERSION, type EditorDefinition } from './types.js';

/** `vendor.name`, the same rule as `CUSTOM_EDITOR_ID_PATTERN` in @shapio/schema. */
const EDITOR_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/;

/**
 * Declares a field editor. Export the result from your editor module as `editor`:
 *
 * ```tsx
 * export const editor = defineEditor({
 *   id: 'acme.starRating',
 *   dataTypes: ['integer'],
 *   component: StarRating,
 * });
 * ```
 *
 * It stamps the contract version the editor was built against, so the admin can refuse an editor built
 * for an incompatible release instead of failing at runtime.
 */
export const defineEditor = <T extends DataType>(
  definition: Omit<EditorDefinition<T>, 'contractVersion'>,
): EditorDefinition<T> => {
  if (!EDITOR_ID_PATTERN.test(definition.id)) {
    throw new Error(
      `Editor ID "${definition.id}" must be namespaced like "acme.starRating" (letters, digits, _ and -)`,
    );
  }
  if (definition.dataTypes.length === 0) {
    throw new Error(`Editor "${definition.id}" must list at least one data type`);
  }
  return { ...definition, contractVersion: EDITOR_CONTRACT_VERSION };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Runtime check of a module export (the admin's loader uses it on untrusted modules). */
export const isEditorDefinition = (value: unknown): value is EditorDefinition =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  EDITOR_ID_PATTERN.test(value.id) &&
  typeof value.contractVersion === 'number' &&
  Array.isArray(value.dataTypes) &&
  value.dataTypes.every((type) => typeof type === 'string') &&
  (typeof value.component === 'function' || isRecord(value.component));
