import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCreateSchedule } from '@/api/schedules';
import { settle } from '@/helpers/settle';
import { dateTimeLocalField, dateTimeLocalToIso, defaultScheduleValue } from '../../helpers/dateTimeLocal';
import { EMPTY_ENTRY_TARGET, entryTargetShape, toEntryTarget } from '../../helpers/entryTarget';
import { useResetOnOpen } from '../../hooks/useResetOnOpen';

const createScheduleSchema = z.object({ ...entryTargetShape, runAt: dateTimeLocalField() });

type CreateScheduleValues = z.infer<typeof createScheduleSchema>;

export const useCreateScheduleForm = (open: boolean, onCreated: () => void) => {
  const createSchedule = useCreateSchedule();
  const defaults = useMemo<CreateScheduleValues>(
    () => ({ ...EMPTY_ENTRY_TARGET, runAt: open ? defaultScheduleValue() : '' }),
    [open],
  );
  const form = useForm<CreateScheduleValues>({
    resolver: zodResolver(createScheduleSchema),
    defaultValues: defaults,
  });
  useResetOnOpen(open, form.reset, defaults, createSchedule.reset);
  const onSubmit = form.handleSubmit(async ({ runAt, ...target }) => {
    const iso = dateTimeLocalToIso(runAt);
    if (!iso) {
      return;
    }
    const created = await settle(createSchedule.mutateAsync({ ...toEntryTarget(target), runAt: iso }));
    if (created.ok) {
      onCreated();
    }
  });
  return { form, onSubmit, createSchedule };
};
