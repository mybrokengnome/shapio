import type { AdminEntryListItem, PresencePerson } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { Checkbox } from '@/components/ui/checkbox';
import { Thumbnail } from '@/features/Media/Thumbnail';
import { cn } from '@/helpers/cn';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { EntryStatusChip } from '../../../EntryStatusChip';
import { coverAssetOf } from '../../helpers/cover';
import { Presence } from '../../Presence';
import type { RowContext } from '../../Row';
import { RowActions } from '../../RowActions';

type CardProps = {
  context: RowContext;
  cover: FieldDefinition;
  item: AdminEntryListItem;
  label: string;
  selected: boolean;
  people: readonly PresencePerson[];
  onSelectChange: (checked: boolean) => void;
};

/** One entry as a tile: its cover, title, status and last update; tick box and actions on hover. */
export const Card = ({ context, cover, item, label, selected, people, onSelectChange }: CardProps) => {
  const { t } = useTranslation();
  const { model, locale } = context;
  const asset = coverAssetOf(item.data[cover.apiKey]);
  return (
    <li
      className={cn(
        'group/row relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors focus-within:border-input hover:border-input',
        selected && 'border-primary focus-within:border-primary hover:border-primary',
      )}
    >
      {asset ? (
        <Thumbnail asset={asset} className="aspect-video w-full" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground">
          <ImageOff aria-hidden="true" className="size-6" />
        </div>
      )}
      <Checkbox
        checked={selected}
        aria-label={t('place.list.select', { entry: label })}
        className={cn(
          'absolute top-3 left-3 bg-card',
          !selected && 'md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100',
        )}
        onCheckedChange={(checked) => onSelectChange(checked === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <RowTitle asChild className="line-clamp-2 min-w-0">
            <Link
              to="/content/$modelKey/$entryId"
              params={{ modelKey: model.apiKey, entryId: item.id }}
              search={locale ? { locale } : {}}
            >
              {label}
            </Link>
          </RowTitle>
          <Presence people={people} />
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <EntryStatusChip status={item.status} size="sm" />
            <time
              dateTime={item.updatedAt}
              title={formatDateTime(item.updatedAt)}
              className="truncate text-meta text-muted-foreground"
            >
              {formatRelativeTime(item.updatedAt)}
            </time>
          </div>
          <RowActions
            modelKey={model.apiKey}
            entry={item}
            label={label}
            locale={locale}
            localeLabel={locale ? context.localeLabelOf(locale) : null}
            permissions={context.permissions}
            actions={context.actions}
            onPreview={context.onPreview}
          />
        </div>
      </div>
    </li>
  );
};
