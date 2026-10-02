import type { DefinitionCategory } from '@shapio/client';
import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { create } from 'zustand';

/** What the builder's settings panel shows: the definition's own settings, or one field. */
export type DraftSelection = { type: 'definition' } | { type: 'field'; fieldId: string };

type DraftState = {
  /** `${category}:${id}` of the definition being edited, or null before one is loaded. */
  key: string | null;
  category: DefinitionCategory;
  /** The active definition the draft is based on, and its version (sent as `expectedVersion`). */
  base: SchemaDefinition | null;
  baseVersion: number;
  draft: SchemaDefinition | null;
  selection: DraftSelection;
  /**
   * Starts editing a definition, discarding any previous draft. Reloading the same definition keeps the
   * selected field open if it still exists.
   */
  load: (category: DefinitionCategory, definition: SchemaDefinition, version: number) => void;
  /** Forgets the draft (the builder closed). */
  reset: () => void;
  /** Moves the base to a newer version with the edits re-applied on top (after a conflict, by choice). */
  rebase: (definition: SchemaDefinition, version: number, draft: SchemaDefinition) => void;
  update: (recipe: (draft: SchemaDefinition) => SchemaDefinition) => void;
  updateField: (fieldId: string, recipe: (field: FieldDefinition) => FieldDefinition) => void;
  select: (selection: DraftSelection) => void;
};

const keyOf = (category: DefinitionCategory, id: string) => `${category}:${id}`;

/**
 * The model builder's unsaved definition (client-only state). Edits are immutable updates of a normalized
 * definition, which is also what the plan and apply endpoints accept.
 */
export const useDefinitionDraftStore = create<DraftState>()((set) => ({
  key: null,
  category: 'model',
  base: null,
  baseVersion: 0,
  draft: null,
  selection: { type: 'definition' },
  load: (category, definition, version) =>
    set((state) => {
      const key = keyOf(category, definition.id);
      const { selection } = state;
      const keepSelection =
        state.key === key &&
        (selection.type === 'definition' ||
          definition.fields.some((field) => field.id === selection.fieldId));
      return {
        key,
        category,
        base: definition,
        baseVersion: version,
        draft: definition,
        selection: keepSelection ? selection : { type: 'definition' },
      };
    }),
  reset: () => set({ key: null, base: null, baseVersion: 0, draft: null, selection: { type: 'definition' } }),
  rebase: (definition, version, draft) => set({ base: definition, baseVersion: version, draft }),
  update: (recipe) => set((state) => (state.draft ? { draft: recipe(state.draft) } : {})),
  updateField: (fieldId, recipe) =>
    set((state) =>
      state.draft
        ? {
            draft: {
              ...state.draft,
              fields: state.draft.fields.map((field) => (field.id === fieldId ? recipe(field) : field)),
            },
          }
        : {},
    ),
  select: (selection) => set({ selection }),
}));

/** The store key of a definition: drafts are per category and ID. */
export const draftKeyOf = keyOf;
