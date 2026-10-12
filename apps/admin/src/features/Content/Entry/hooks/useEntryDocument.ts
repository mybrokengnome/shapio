import type { DraftState } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useState } from 'react';
import { useStore } from 'zustand';
import { selectDirtyKeys } from '@/fields/form/store';
import { isEmptyValue, type FormValues } from '@/fields/helpers/values';
import { useFollowingSlugs } from '@/fields/hooks/useFollowingSlugs';
import type { ContentSchema } from '../../hooks/useContentSchema';
import type { EntryMode, ReloadEntry } from '../types';
import { useAutosave } from './useAutosave';
import { useEntryLifecycle } from './useEntryLifecycle';
import { useEntryPermissions } from './useEntryPermissions';
import { useEntrySaver } from './useEntrySaver';
import { useEntrySetup } from './useEntrySetup';
import { usePublishing } from './usePublishing';
import { useRemoteDraftChange } from './useRemoteDraftChange';

type EntryDocumentOptions = {
  schema: ContentSchema;
  model: ModelDefinition;
  mode: EntryMode;
  locale: string | null;
  defaultLocale: string | undefined;
  carry: FormValues | undefined;
  onReload: ReloadEntry;
  /** Every locale's draft as the presence heartbeat last saw it (saves made elsewhere). */
  drafts: readonly DraftState[];
};

/**
 * Everything one open entry document does, composed: its value store and field environment, saving
 * (autosave, Save, the version guard and conflicts), creating, deleting, duplicating, restoring, copying
 * between locales, publishing per locale, noticing saves made elsewhere, and what the admin is allowed to do.
 */
export const useEntryDocument = ({
  schema,
  model,
  mode,
  locale,
  defaultLocale,
  carry,
  onReload,
  drafts,
}: EntryDocumentOptions) => {
  const permissions = useEntryPermissions(model);
  const [conflict, setConflict] = useState<string | undefined>();
  const [reloading, setReloading] = useState(false);
  const setup = useEntrySetup({
    schema,
    model,
    mode,
    locale,
    carry,
    disabled: conflict !== undefined || reloading,
    readOnly: mode.kind === 'create' ? !permissions.canCreate : !permissions.canUpdate,
  });
  const { store, entry, setEntry, versionRef, entryId } = setup;
  const dirty = useStore(store, (state) => selectDirtyKeys(state).length > 0);
  // Copying from the default locale replaces localized values: it asks first when there are some.
  const hasLocalizedValues = useStore(store, (state) =>
    model.fields.some((field) => field.localized && !isEmptyValue(state.values[field.apiKey])),
  );
  const saver = useEntrySaver({
    model,
    components: schema.components,
    entryId: entryId ?? '',
    locale,
    store,
    versionRef,
    onAsset: setup.onAsset,
    onConflict: (error) => setConflict(error.code),
    onSaved: (saved) => {
      setEntry(saved);
      if (mode.kind === 'newLocale') {
        onReload(null);
      }
    },
  });
  const lifecycle = useEntryLifecycle({
    model,
    components: schema.components,
    store,
    entryId,
    locale,
    defaultLocale,
    versionRef,
    exclusive: saver.exclusive,
    onAsset: setup.onAsset,
    onConflict: setConflict,
    onRestored: () => onReload(null),
  });
  const publishing = usePublishing({
    modelKey: model.apiKey,
    entryId,
    autosaved: entry?.autosaved ?? false,
    locale,
    versionRef,
    entryLocales: entry?.locales ?? [],
    store,
    save: saver.save,
    exclusive: saver.exclusive,
    onEntry: (next) => {
      setEntry(next);
      versionRef.current = next.version;
    },
    onConflict: (error) => setConflict(error.code),
  });
  const { remoteChange } = useRemoteDraftChange({
    drafts,
    locale: entry?.locale,
    shownVersion: entry?.version,
    dirty,
    busy:
      saver.state.status === 'saving' ||
      publishing.publishing ||
      publishing.unpublishing ||
      lifecycle.restoring,
    conflict,
    onConflict: setConflict,
  });
  const editable = !setup.environment.readOnly;
  useFollowingSlugs(store, model, editable && mode.kind !== 'newLocale');
  useAutosave(
    store,
    mode.kind === 'edit' && model.draftAndPublish && conflict === undefined && editable,
    saver.save,
  );
  const save = () => (mode.kind === 'create' ? void lifecycle.create() : void saver.save('save'));
  const reload = (keepChanges: boolean) => {
    setReloading(true);
    const { values: current, baseline } = store.getState();
    const local = Object.fromEntries(
      selectDirtyKeys({ values: current, baseline }).map((key) => [key, current[key]]),
    );
    onReload(keepChanges ? local : null);
  };
  return {
    setup,
    permissions,
    conflict,
    remoteChange,
    reloading,
    dirty,
    hasLocalizedValues,
    saver,
    lifecycle,
    publishing,
    save,
    reload,
    editable,
  };
};
