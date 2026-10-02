import { CalendarClock } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateSchedule } from '@/api/schedules';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dateTimeLocalToIso, defaultScheduleValue } from '@/features/Publishing/helpers/dateTimeLocal';

type ScheduleFormProps = {
  modelKey: string;
  entryId: string;
  locale: string | null;
  onScheduled: (runAt: string) => void;
};

/** "Schedule…": publish this locale at a time (the browser's time zone), inline in the pre-flight. */
export const ScheduleForm = ({ modelKey, entryId, locale, onScheduled }: ScheduleFormProps) => {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState(defaultScheduleValue);
  const [invalid, setInvalid] = useState(false);
  const create = useCreateSchedule();
  return (
    <form
      noValidate
      className="space-y-2 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const runAt = dateTimeLocalToIso(value);
        if (!runAt) {
          setInvalid(true);
          return;
        }
        create.mutate(
          { modelKey, entryId, ...(locale ? { locale } : {}), action: 'publish', runAt },
          { onSuccess: () => onScheduled(runAt) },
        );
      }}
    >
      <Label htmlFor={id}>{t('entry.preflight.scheduleAt')}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          type="datetime-local"
          className="w-auto"
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
        />
        <SubmitButton pending={create.isPending} pendingLabel={t('common.saving')} variant="outline">
          <CalendarClock aria-hidden="true" />
          {t('entry.preflight.scheduleConfirm')}
        </SubmitButton>
      </div>
      <p
        id={`${id}-hint`}
        className={invalid ? 'text-meta text-destructive' : 'text-meta text-muted-foreground'}
      >
        {invalid
          ? t('validation.dateTime')
          : t('publishing.fields.localTimeHint', {
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })}
      </p>
      <FormError error={create.error} />
    </form>
  );
};
