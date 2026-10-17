import type { AdminEntry, MediaAsset } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { queryKeys } from '@/api/queryKeys';
import type { FieldsEnvironment, LinkedValue } from '@/fields/form/context';
import { createEntryFormStore } from '@/fields/form/store';
import { defaultFormValues, toFormValues } from '@/fields/helpers/formValues';
import type { FormValues } from '@/fields/helpers/values';
import { useMediaPickerDialog } from '@/fields/hooks/useMediaPickerDialog';
import { useRuntimeEditors } from '@/fields/runtime/useRuntimeEditors';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import { useMediaUploader } from '@/hooks/useMediaUploader';
import type { ContentSchema } from '../../hooks/useContentSchema';
import { newLocaleValues } from '../helpers/initialValues';
import type { EntryMode } from '../types';

type SetupOptions = {
  schema: ContentSchema;
  model: ModelDefinition;
  mode: EntryMode;
  locale: string | null;
  carry: FormValues | undefined;
  disabled: boolean;
  /** The admin may not change this entry (no `update`, or no `create` for a new one). */
  readOnly: boolean;
  /** The value the URL opened the entry at, if any. */
  linkedValue?: LinkedValue;
};

/**
 * Everything one open entry document owns: its value store (seeded from the loaded entry, a new locale's
 * shared values, or defaults), the server's latest view of the entry and its version, and the environment
 * every field editor sees (schema, locale, custom editors, the media picker).
 */
export const useEntrySetup = ({
  schema,
  model,
  mode,
  locale,
  carry,
  disabled,
  readOnly,
  linkedValue,
}: SetupOptions) => {
  const queryClient = useQueryClient();
  const runtime = useRuntimeEditors();
  const { pickMedia, dialog: mediaDialog } = useMediaPickerDialog();
  const { canWrite: canUpload } = useMediaPermissions();
  const { uploadOne } = useMediaUploader();
  const onAsset = useCallback(
    (asset: MediaAsset) => queryClient.setQueryData(queryKeys.media.asset(asset.id), asset),
    [queryClient],
  );
  const [store] = useState(() => {
    const initial =
      mode.kind === 'edit'
        ? toFormValues(model.fields, mode.entry.data, schema.components, onAsset)
        : mode.kind === 'newLocale'
          ? newLocaleValues(model, mode.source, schema.components, onAsset)
          : defaultFormValues(model.fields);
    const created = createEntryFormStore(initial);
    if (carry) {
      created.getState().patchValues(carry);
    }
    return created;
  });
  const [entry, setEntry] = useState<AdminEntry | null>(mode.kind === 'edit' ? mode.entry : null);
  const versionRef = useRef<number | null>(mode.kind === 'edit' ? mode.entry.version : null);
  const entryId = mode.kind === 'edit' ? mode.entry.id : mode.kind === 'newLocale' ? mode.entryId : null;
  const environment = useMemo<FieldsEnvironment>(
    () => ({
      idPrefix: 'entry-',
      model,
      components: schema.components,
      models: schema.models,
      locale,
      entryId,
      readOnly,
      disabled,
      runtimeEditors: runtime.editors,
      pickMedia,
      ...(canUpload && !readOnly ? { uploadMedia: uploadOne } : {}),
      ...(linkedValue ? { linkedValue } : {}),
    }),
    [
      model,
      schema,
      locale,
      entryId,
      readOnly,
      disabled,
      runtime.editors,
      pickMedia,
      canUpload,
      uploadOne,
      linkedValue,
    ],
  );
  return {
    store,
    entry,
    setEntry,
    versionRef,
    entryId,
    environment,
    mediaDialog,
    onAsset,
    runtimeLoading: runtime.isLoading,
  };
};
