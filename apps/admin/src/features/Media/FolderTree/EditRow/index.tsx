import { Check, FolderPlus, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useId, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FormFieldError } from '@/components/FormFieldError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeError } from '@/helpers/describeError';
import { useFolderForm, type FolderEdit } from '../../hooks/useFolderForm';

type EditRowProps = {
  edit: FolderEdit;
  /** `returnFocus`: false when focus already left the row (a click elsewhere), so it isn't pulled back. */
  onDone: (returnFocus: boolean) => void;
};

/**
 * A folder name being typed in place, in the tree (the caller's list item): a new folder or a rename. Enter saves, Escape cancels;
 * leaving the row without changing anything cancels too.
 */
export const EditRow = ({ edit, onDone }: EditRowProps) => {
  const { t } = useTranslation();
  const errorId = useId();
  const { form, onSubmit, initialName, pending, error } = useFolderForm(edit, () => onDone(true));
  const { setFocus } = form;
  useEffect(() => {
    setFocus('name', { shouldSelect: true });
  }, [setFocus]);
  const fieldError = form.formState.errors.name?.message;
  const message = fieldError ?? (error ? describeError(error) : undefined);
  const creating = edit.mode === 'create';
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      event.stopPropagation();
      onDone(true);
    }
  };
  const cancelWhenLeftUnchanged = (event: FocusEvent<HTMLFormElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    if (!pending && form.getValues('name').trim() === initialName) {
      onDone(false);
    }
  };
  return (
    <div>
      <form
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        onKeyDown={cancelOnEscape}
        onBlur={cancelWhenLeftUnchanged}
        className="flex items-center gap-1 py-0.5 pl-1"
      >
        {creating ? (
          <FolderPlus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Pencil aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        )}
        <Input
          {...form.register('name')}
          inputSize="sm"
          autoComplete="off"
          spellCheck={false}
          readOnly={pending}
          aria-label={
            creating ? t('media.folders.newName') : t('media.folders.renameLabel', { name: edit.folder.name })
          }
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : undefined}
          className="h-8 px-2"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={pending}
          aria-label={creating ? t('media.folders.create') : t('media.folders.saveName')}
        >
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={pending}
          aria-label={t('common.cancel')}
          onClick={() => onDone(true)}
        >
          <X aria-hidden="true" />
        </Button>
      </form>
      <div className="pl-6">
        <FormFieldError id={errorId} message={message} />
      </div>
    </div>
  );
};
