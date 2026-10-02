import { Link, type LinkOptions } from '@tanstack/react-router';
import { RowTitle } from '@/components/RowTitle';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';

type EntryRowProps = {
  title: string;
  /** One line under the title: the place, and what happens or happened. */
  meta: string;
  link: LinkOptions;
  /** When it happens or happened, shown relative on the right. */
  at?: string;
};

/** An entry in the Inbox's side lists: title linking to the document, a meta line and a relative time. */
export const EntryRow = ({ title, meta, link, at }: EntryRowProps) => (
  <li className="flex items-center gap-3 px-5 py-2.5">
    <div className="min-w-0 flex-1 space-y-0.5">
      <RowTitle asChild className="block truncate text-sm">
        <Link {...link}>{title}</Link>
      </RowTitle>
      <p className="truncate text-meta text-muted-foreground">{meta}</p>
    </div>
    {at ? (
      <time
        dateTime={at}
        title={formatDateTime(at)}
        className="shrink-0 text-meta whitespace-nowrap text-muted-foreground"
      >
        {formatRelativeTime(at)}
      </time>
    ) : null}
  </li>
);
