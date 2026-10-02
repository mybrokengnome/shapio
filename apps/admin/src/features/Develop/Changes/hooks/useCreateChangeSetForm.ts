import { zodResolver } from '@hookform/resolvers/zod';
import type { ChangeSet } from '@shapio/client';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCreateChangeSet } from '@/api/changeSets';
import { useResetOnOpen } from '@/features/Publishing/hooks/useResetOnOpen';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';

const createChangeSetSchema = z.object({
  title: requiredText().max(200, 'validation.tooLong'),
  description: z.string().max(5000, 'validation.tooLong'),
});

type CreateChangeSetValues = z.infer<typeof createChangeSetSchema>;

const EMPTY: CreateChangeSetValues = { title: '', description: '' };

export const useCreateChangeSetForm = (open: boolean, onCreated: (set: ChangeSet) => void) => {
  const createChangeSet = useCreateChangeSet();
  const form = useForm<CreateChangeSetValues>({
    resolver: zodResolver(createChangeSetSchema),
    defaultValues: EMPTY,
  });
  const { reset } = form;
  useResetOnOpen(open, reset, EMPTY, createChangeSet.reset);
  const onSubmit = form.handleSubmit(async ({ title, description }) => {
    const created = await settle(
      createChangeSet.mutateAsync({ title: title.trim(), description: description.trim() }),
    );
    if (created.ok) {
      reset(EMPTY);
      onCreated(created.value);
    }
  });
  return { form, onSubmit, createChangeSet };
};
