import type { LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormTextareaField } from '@/components/FormTextareaField';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { settle } from '@/helpers/settle';

export type NoteAction = {
  key: string;
  label: string;
  /** The action refuses an empty note (requesting changes says what to change). */
  requiresNote?: boolean;
  run: (note: string) => Promise<unknown>;
};

type NotePopoverProps = {
  triggerLabel: string;
  icon: LucideIcon;
  title: string;
  noteLabel: string;
  /** Secondary actions first; the last one is the primary (Enter submits it). */
  actions: readonly NoteAction[];
};

type NoteValues = { note: string };

/** An approval step with a note, asked for in a popover beside its button (like Schedule…). */
export const NotePopover = ({ triggerLabel, icon: Icon, title, noteLabel, actions }: NotePopoverProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const form = useForm<NoteValues>({ defaultValues: { note: '' } });
  const primary = actions.at(-1);
  const secondary = actions.slice(0, -1);
  const onOpenChange = (next: boolean) => {
    if (running && !next) {
      return;
    }
    if (next) {
      form.reset({ note: '' });
      setError(null);
    }
    setOpen(next);
  };
  const run = (action: NoteAction) =>
    form.handleSubmit(async ({ note }) => {
      const trimmed = note.trim();
      if (action.requiresNote && trimmed === '') {
        form.setError('note', { message: t('changes.approval.noteRequired') });
        return;
      }
      setRunning(action.key);
      const result = await settle(action.run(trimmed));
      setRunning(null);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Icon aria-hidden="true" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="w-80">
        <form
          noValidate
          onSubmit={(event) => (primary ? void run(primary)(event) : event.preventDefault())}
          className="space-y-4"
        >
          <p id={titleId} className="text-sm font-semibold">
            {title}
          </p>
          <FormTextareaField control={form.control} name="note" label={noteLabel} rows={3} maxLength={2000} />
          <FormError error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            {secondary.map((action) => (
              <Button
                key={action.key}
                type="button"
                size="sm"
                variant="outline"
                disabled={running !== null}
                aria-busy={running === action.key || undefined}
                onClick={() => void run(action)()}
              >
                {running === action.key ? t('common.saving') : action.label}
              </Button>
            ))}
            {primary ? (
              <SubmitButton
                size="sm"
                pending={running === primary.key}
                pendingLabel={t('common.saving')}
                disabled={running !== null}
              >
                {primary.label}
              </SubmitButton>
            ) : null}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};
