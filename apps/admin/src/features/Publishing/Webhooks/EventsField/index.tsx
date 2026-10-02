import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useWebhookEvents } from '@/api/webhooks';
import { ErrorState } from '@/components/ErrorState';
import { FormFieldError } from '@/components/FormFieldError';
import { InfoHint } from '@/components/InfoHint';
import { LoadingState } from '@/components/LoadingState';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { groupEvents, groupPattern, toggleEvent, toggleGroup } from '../../helpers/webhookEvents';
import type { WebhookFormValues } from '../helpers';

type EventsFieldProps = { control: Control<WebhookFormValues> };

/** The events a webhook receives, grouped; "all <group> events" subscribes to future ones too. */
export const EventsField = ({ control }: EventsFieldProps) => {
  const { t } = useTranslation();
  const catalogue = useWebhookEvents();
  const { field, fieldState } = useController({ control, name: 'events' });
  const selected = field.value;
  if (catalogue.isPending) {
    return <LoadingState rows={2} />;
  }
  if (catalogue.isError) {
    return <ErrorState error={catalogue.error} onRetry={() => void catalogue.refetch()} />;
  }
  return (
    <FieldSet data-invalid={fieldState.invalid || undefined} aria-labelledby="webhook-events-title">
      <FieldLegend variant="label" className="flex items-center gap-1">
        <span id="webhook-events-title">{t('publishing.webhooks.events')}</span>
        <InfoHint about={t('publishing.webhooks.events')}>{t('publishing.webhooks.eventsHint')}</InfoHint>
      </FieldLegend>
      <div className="space-y-4">
        {groupEvents(catalogue.data).map((group) => {
          const groupSelected = selected.includes(groupPattern(group.group));
          const groupId = `webhook-events-${group.group}`;
          return (
            <fieldset key={group.group} className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 font-mono text-xs font-semibold">{group.group}</legend>
              <Field orientation="horizontal">
                <Checkbox
                  id={groupId}
                  checked={groupSelected}
                  onCheckedChange={(checked) =>
                    field.onChange(toggleGroup(selected, group, checked === true))
                  }
                  onBlur={field.onBlur}
                />
                <FieldLabel htmlFor={groupId} className="font-medium">
                  {t('publishing.webhooks.allGroupEvents', { group: group.group })}
                </FieldLabel>
              </Field>
              <div className="grid gap-2 pl-6 sm:grid-cols-2">
                {group.types.map((type) => {
                  const id = `webhook-event-${type}`;
                  return (
                    <Field key={type} orientation="horizontal">
                      <Checkbox
                        id={id}
                        checked={groupSelected || selected.includes(type)}
                        disabled={groupSelected}
                        onCheckedChange={(checked) =>
                          field.onChange(toggleEvent(selected, type, checked === true))
                        }
                        onBlur={field.onBlur}
                      />
                      <FieldLabel htmlFor={id} className="font-mono text-xs font-normal">
                        {type}
                      </FieldLabel>
                    </Field>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
      <FormFieldError message={fieldState.error?.message} />
    </FieldSet>
  );
};
