import { zodResolver } from '@hookform/resolvers/zod';
import type { DeploymentConnection } from '@shapio/client';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUpdateDeploymentConnection } from '@/api/deployments';
import { isConflict } from '@/api/errors';
import { settle } from '@/helpers/settle';
import {
  connectionSchema,
  regenerableSecrets,
  toConnectionValues,
  toUpdateConnectionInput,
  type ConnectionFormValues,
} from '../helpers/connectionForm';

const editSchema = connectionSchema('edit');

/**
 * Edits one version of a connection (the form is re-created when the version changes). Saves send the
 * version they started from; a 409 goes to `onConflict`. `onSaved` receives any secret the server generated
 * (replacing one it could no longer read), for the page to show once.
 */
export const useEditConnectionForm = (
  connection: DeploymentConnection,
  onSaved: (generatedSecrets: Record<string, string> | undefined) => void,
  onConflict: (error: unknown) => void,
) => {
  const { t } = useTranslation();
  const update = useUpdateDeploymentConnection();
  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: toConnectionValues(connection),
  });
  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await settle(
      update.mutateAsync(
        {
          id: connection.id,
          input: toUpdateConnectionInput(values, connection.version, regenerableSecrets(connection)),
        },
        { onError: onConflict },
      ),
    );
    if (saved.ok) {
      toast.success(t('publishing.deployments.saved'));
      onSaved(saved.value.generatedSecrets);
    }
  });
  return { form, onSubmit, update, error: isConflict(update.error) ? undefined : update.error };
};
