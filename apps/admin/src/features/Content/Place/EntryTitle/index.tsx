import type { PresencePerson } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { RowTitle } from '@/components/RowTitle';
import { cn } from '@/helpers/cn';
import { Presence } from '../Presence';

type EntryTitleProps = {
  modelKey: string;
  entryId: string;
  label: string;
  /** Carried into the document link; null for models that aren't localized. */
  locale: string | null;
  people: readonly PresencePerson[];
  className?: string;
};

/** A row's title: the link to the document, then who is editing it right now. */
export const EntryTitle = ({ modelKey, entryId, label, locale, people, className }: EntryTitleProps) => (
  <span className={cn('flex min-w-0 items-center gap-2', className)}>
    <RowTitle asChild className="min-w-0 truncate">
      <Link to="/content/$modelKey/$entryId" params={{ modelKey, entryId }} search={locale ? { locale } : {}}>
        {label}
      </Link>
    </RowTitle>
    <Presence people={people} />
  </span>
);
