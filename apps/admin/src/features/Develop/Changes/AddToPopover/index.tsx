import type { UnassignedEntry } from '@shapio/client';
import { FolderPlus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChangeSets } from '@/api/changeSets';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { logError } from '@/helpers/reportError';
import { useAddToChangeSet } from '../hooks/useAddToChangeSet';

type AddToPopoverProps = { entry: UnassignedEntry; label: string };

/** "Add to…": pick an open change set, or name a new one, for an entry draft. */
export const AddToPopover = ({ entry, label }: AddToPopoverProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const sets = useChangeSets('open');
  const { addTo, createAndAdd, pending, error, reset } = useAddToChangeSet(entry);
  const run = (action: () => Promise<void>) =>
    void action().then(
      () => setOpen(false),
      (cause: unknown) => logError(cause, 'adding an entry to a change set'),
    );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) {
          return;
        }
        setOpen(next);
        if (next) {
          reset();
          setNewTitle('');
        }
      }}
      modal
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
          <FolderPlus aria-hidden="true" />
          {t('changes.addTo')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="w-80 space-y-3">
        <p id={titleId} className="text-sm font-semibold">
          {t('changes.addToTitle')}
        </p>
        {sets.data && sets.data.items.length > 0 ? (
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {sets.data.items.map((set) => (
              <li key={set.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start truncate"
                  disabled={pending}
                  onClick={() => run(() => addTo(set.id))}
                >
                  {set.title}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-muted-foreground">{t('changes.noOpenSets')}</p>
        )}
        <form
          noValidate
          className="space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const title = newTitle.trim();
            if (title) {
              run(() => createAndAdd(title));
            }
          }}
        >
          <label htmlFor={inputId} className="text-sm font-semibold">
            {t('changes.newSetTitle')}
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              inputSize="sm"
              value={newTitle}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => setNewTitle(event.target.value)}
            />
            <SubmitButton
              size="sm"
              pending={pending}
              pendingLabel={t('common.saving')}
              disabled={!newTitle.trim()}
            >
              {t('common.create')}
            </SubmitButton>
          </div>
        </form>
        <FormError error={error} />
      </PopoverContent>
    </Popover>
  );
};
