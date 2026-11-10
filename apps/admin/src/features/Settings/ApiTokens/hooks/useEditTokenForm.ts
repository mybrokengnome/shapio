import { zodResolver } from '@hookform/resolvers/zod';
import type { ApiToken } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useUpdateApiToken } from '@/api/tokens';
import { settle } from '@/helpers/settle';
import {
  fromPinnedSchemaVersion,
  pinnedSchemaVersionField,
  toPinnedSchemaVersion,
} from '../helpers/schemaVersionPin';

const editTokenSchema = z.object({ pinnedSchemaVersion: pinnedSchemaVersionField() });

export type EditTokenValues = z.infer<typeof editTokenSchema>;

/** The edit form of one token (its schema version pin), reset to the token each time the sheet opens. */
export const useEditTokenForm = (
  open: boolean,
  token: ApiToken | undefined,
  onSaved: (saved: ApiToken) => void,
) => {
  const updateToken = useUpdateApiToken();
  const form = useForm<EditTokenValues>({
    resolver: zodResolver(editTokenSchema),
    defaultValues: { pinnedSchemaVersion: '' },
  });
  const { reset } = form;
  const { reset: resetMutation } = updateToken;
  useEffect(() => {
    if (open && token) {
      reset({ pinnedSchemaVersion: fromPinnedSchemaVersion(token.pinnedSchemaVersion) });
      resetMutation();
    }
  }, [open, token, reset, resetMutation]);
  const onSubmit = form.handleSubmit(async ({ pinnedSchemaVersion }) => {
    if (!token) {
      return;
    }
    const saved = await settle(
      updateToken.mutateAsync({
        id: token.id,
        input: { pinnedSchemaVersion: toPinnedSchemaVersion(pinnedSchemaVersion) },
      }),
    );
    if (saved.ok) {
      onSaved(saved.value);
    }
  });
  const pinCurrent = (version: number) =>
    form.setValue('pinnedSchemaVersion', String(version), { shouldDirty: true, shouldValidate: true });
  return { form, onSubmit, updateToken, pinCurrent };
};
