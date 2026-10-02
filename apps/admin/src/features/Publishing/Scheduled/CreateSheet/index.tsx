import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { FormTextField } from '@/components/FormTextField';
import { EntryTargetFields } from '../../EntryTargetFields';
import { useCreateScheduleForm } from '../hooks/useCreateScheduleForm';

type CreateSheetProps = { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void };

export const CreateSheet = ({ open, onOpenChange, onCreated }: CreateSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, createSchedule } = useCreateScheduleForm(open, onCreated);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('publishing.scheduled.createTitle')}
      dirty={form.formState.isDirty}
      pending={createSchedule.isPending}
      submitLabel={t('publishing.scheduled.create')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <EntryTargetFields control={form.control} />
      <FormTextField
        control={form.control}
        name="runAt"
        type="datetime-local"
        label={t('publishing.fields.runAt')}
        description={t('publishing.fields.localTimeHint', {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })}
      />
      <FormError error={createSchedule.error} />
    </FormSheet>
  );
};
