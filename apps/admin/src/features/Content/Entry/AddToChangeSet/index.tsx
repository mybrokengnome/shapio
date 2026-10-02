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
import { useAddEntryToChangeSet } from '../hooks/useAddEntryToChangeSet';

type AddToChangeSetProps = {
  entryId: string;
  /** The locale being edited (null for a non-localized model). */
  locale: string | null;
  disabled: boolean;
  /** Runs once the entry is in a set (the pre-flight closes). */
  onAdded: () => void;
};

/**
 * "Add to change set…" in the pre-flight: publish this locale when a change set ships, instead of now.
 * Pick an open set, or name a new one.
 */
export const AddToChangeSet = ({ entryId, locale, disabled, onAdded }: AddToChangeSetProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const sets = useChangeSets('open');
  const { addTo, createAndAdd, pending, error, reset } = useAddEntryToChangeSet(entryId, locale);
  const run = (action: () => Promise<void>) =>
    void action().then(
      () => {
        setOpen(false);
        onAdded();
      },
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
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <FolderPlus aria-hidden="true" />
          {t('entry.changeSet.add')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" aria-labelledby={titleId} className="w-80 space-y-3">
        <p id={titleId} className="text-sm font-semibold">
          {t('entry.changeSet.title')}
        </p>
        {sets.data && sets.data.items.length > 0 ? (
          <ul aria-label={t('entry.changeSet.openSets')} className="max-h-56 space-y-1 overflow-y-auto">
            {sets.data.items.map((set) => (
              <li key={set.id}>
                <Button
                  type="button"
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
          <p className="text-meta text-muted-foreground">{t('entry.changeSet.none')}</p>
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
            {t('entry.changeSet.newTitle')}
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
