import type { EditorDefinition, PickedMedia, MediaPickOptions } from '@shapio/editor-sdk';
import type { ComponentDefinition, ModelDefinition, SchemaDefinition } from '@shapio/schema';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { UploadedMedia } from '@/hooks/useMediaUploader';
import type { EntryFormState, EntryFormStore } from './store';

/** What every field editor in a form shares: the schema, the entry, and capabilities. */
export type FieldsEnvironment = {
  /** Prefix for DOM ids, unique per form on the page (the page's form and an inline-create drawer). */
  idPrefix: string;
  /** The model the entry belongs to. */
  model: ModelDefinition;
  /** Components by stable ID (for component and dynamic-zone fields). */
  components: ReadonlyMap<string, ComponentDefinition>;
  /** Every model by stable ID (relation targets). */
  models: ReadonlyMap<string, ModelDefinition>;
  /** The locale being edited, or null when the model is not localized. */
  locale: string | null;
  entryId: string | null;
  /** Nothing can be changed (no update permission, viewing history). */
  readOnly: boolean;
  /** Temporarily unavailable (saving a conflict resolution, reloading). */
  disabled: boolean;
  runtimeEditors: ReadonlyMap<string, EditorDefinition>;
  pickMedia: (options?: MediaPickOptions) => Promise<PickedMedia[] | null>;
  /**
   * Uploads one file into the library (public, root folder) and resolves with the new asset, for files
   * dropped or pasted into rich text. Absent without `media.write`: editors then don't accept files.
   */
  uploadMedia?: (file: File) => Promise<UploadedMedia>;
};

export const FieldsEnvironmentContext = createContext<FieldsEnvironment | null>(null);
export const EntryFormStoreContext = createContext<EntryFormStore | null>(null);

export const useFieldsEnvironment = (): FieldsEnvironment => {
  const environment = useContext(FieldsEnvironmentContext);
  if (!environment) {
    throw new Error('useFieldsEnvironment must be used inside <FieldsProvider>');
  }
  return environment;
};

export const useEntryFormStore = (): EntryFormStore => {
  const store = useContext(EntryFormStoreContext);
  if (!store) {
    throw new Error('useEntryFormStore must be used inside <FieldsProvider>');
  }
  return store;
};

export const useEntryForm = <T>(selector: (state: EntryFormState) => T): T =>
  useStore(useEntryFormStore(), selector);

/** The definition and values of the level a field sits in (the entry, or one component item). */
export type SiblingValues = { definition: SchemaDefinition; values: Readonly<Record<string, unknown>> };

export const SiblingValuesContext = createContext<SiblingValues | null>(null);

export const useSiblingValues = () => useContext(SiblingValuesContext);
