import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarClock } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  dateTimeLocalField,
  dateTimeLocalToIso,
  defaultScheduleValue,
} from '@/features/Publishing/helpers/dateTimeLocal';
import { useResetOnOpen } from '@/features/Publishing/hooks/useResetOnOpen';
import { settle } from '@/helpers/settle';
import type { ShipFlow } from '../hooks/useShipFlow';

const scheduleSchema = z.object({ at: dateTimeLocalField() });
type ScheduleValues = z.infer<typeof scheduleSchema>;

type SchedulePopoverProps = { flow: ShipFlow; disabled: boolean };

/** "Schedule…": when the set ships, picked in a popover beside the button. */
export const SchedulePopover = ({ flow, disabled }: SchedulePopoverProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const defaults = useMemo<ScheduleValues>(() => ({ at: open ? defaultScheduleValue() : '' }), [open]);
  const form = useForm<ScheduleValues>({ resolver: zodResolver(scheduleSchema), defaultValues: defaults });
  useResetOnOpen(open, form.reset, defaults, flow.resetSchedule);
  const onSubmit = form.handleSubmit(async ({ at }) => {
    const iso = dateTimeLocalToIso(at);
    if (iso && (await settle(flow.scheduleAt(iso))).ok) {
      setOpen(false);
    }
  });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => (flow.scheduling && !next ? undefined : setOpen(next))}
      modal
    >
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <CalendarClock aria-hidden="true" />
          {t('changes.review.schedule')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="w-80">
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          <p id={titleId} className="text-sm font-semibold">
            {t('changes.review.scheduleTitle')}
          </p>
          <FormTextField
            control={form.control}
            name="at"
            type="datetime-local"
            label={t('changes.review.scheduleAt')}
            description={t('publishing.fields.localTimeHint', {
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })}
          />
          <FormError error={flow.scheduleError} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SubmitButton size="sm" pending={flow.scheduling} pendingLabel={t('common.saving')}>
              {t('changes.review.schedule')}
            </SubmitButton>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};
