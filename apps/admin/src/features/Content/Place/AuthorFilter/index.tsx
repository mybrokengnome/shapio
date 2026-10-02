import type { EntryAuthor } from '@shapio/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserAvatar } from '@/components/UserAvatar';
import { AddChip } from '../AddChip';

type AuthorFilterProps = {
  choices: readonly EntryAuthor[];
  meId: string | undefined;
  onPick: (authorId: string) => void;
};

/** "+ Created by": only entries a given admin created (you, an author on this page, or anyone listed). */
export const AuthorFilter = ({ choices, meId, onPick }: AuthorFilterProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <AddChip>{t('place.filters.author')}</AddChip>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <ul aria-label={t('place.filters.authors')} className="max-h-72 space-y-0.5 overflow-y-auto">
            {choices.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => {
                    onPick(choice.id);
                    setOpen(false);
                  }}
                >
                  <UserAvatar name={choice.name} size="sm" />
                  <span className="truncate">
                    {choice.id === meId ? t('place.filters.you', { name: choice.name }) : choice.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </li>
  );
};
