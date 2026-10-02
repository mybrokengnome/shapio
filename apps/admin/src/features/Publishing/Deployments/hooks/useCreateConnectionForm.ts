import { zodResolver } from '@hookform/resolvers/zod';
import type { DeploymentConnectionCreated } from '@shapio/client';
import { useForm } from 'react-hook-form';
import { useCreateDeploymentConnection } from '@/api/deployments';
import { settle } from '@/helpers/settle';
import { useResetOnOpen } from '../../hooks/useResetOnOpen';
import {
  connectionSchema,
  EMPTY_CONNECTION,
  toCreateConnectionInput,
  type ConnectionFormValues,
} from '../helpers/connectionForm';

const createSchema = connectionSchema('create');

export const useCreateConnectionForm = (
  open: boolean,
  onCreated: (created: DeploymentConnectionCreated) => void,
) => {
  const createConnection = useCreateDeploymentConnection();
  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: EMPTY_CONNECTION,
  });
  useResetOnOpen(open, form.reset, EMPTY_CONNECTION, createConnection.reset);
  const onSubmit = form.handleSubmit(async (values) => {
    const created = await settle(createConnection.mutateAsync(toCreateConnectionInput(values)));
    if (created.ok) {
      form.reset(EMPTY_CONNECTION);
      onCreated(created.value);
    }
  });
  return { form, onSubmit, createConnection };
};
