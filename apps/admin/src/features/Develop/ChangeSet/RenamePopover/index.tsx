import type { ChangeSet } from '@shapio/client';
import { Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUpdateChangeSet } from '@/api/changeSets';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { settle } from '@/helpers/settle';

type RenamePopoverProps = { set: ChangeSet };

/** The title, edited in place from a pencil button beside it. */
export const RenamePopover = ({ set }: RenamePopoverProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(set.title);
  const update = useUpdateChangeSet();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (update.isPending) {
          return;
        }
        setOpen(next);
        if (next) {
          setTitle(set.title);
          update.reset();
        }
      }}
      modal
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('changes.review.rename')}>
          <Pencil aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-labelledby={titleId} className="w-80">
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const next = title.trim();
            if (!next || next === set.title) {
              setOpen(false);
              return;
            }
            void settle(
              update.mutateAsync({ id: set.id, input: { title: next, expectedVersion: set.version } }),
            ).then((result) => {
              if (result.ok) {
                setOpen(false);
                toast.success(t('changes.review.renamed'));
              }
            });
          }}
        >
          <label id={titleId} htmlFor={inputId} className="text-sm font-semibold">
            {t('changes.fields.title')}
          </label>
          <Input
            id={inputId}
            value={title}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
          />
          <FormError error={update.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SubmitButton
              size="sm"
              pending={update.isPending}
              pendingLabel={t('common.saving')}
              disabled={!title.trim()}
            >
              {t('common.saveChanges')}
            </SubmitButton>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};
