import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/helpers/cn';
import { EntryStatusChip } from '../../../EntryStatusChip';
import { Author } from '../../Author';
import { EntryTitle } from '../../EntryTitle';
import { rowActionsProps } from '../../helpers/rowContext';
import { LocaleFlags } from '../../LocaleFlags';
import { QuickEdit } from '../../QuickEdit';
import type { RowProps } from '../../Row';
import { RowActions } from '../../RowActions';
import { Updated } from '../../Updated';

/**
 * One entry on a phone: tick box, title with presence, then status, author, locales and last update on one
 * wrapping line, and every action in the "…" menu. Quick edit opens underneath.
 */
export const Item = ({ context, item, label, selected, people, onSelectChange }: RowProps) => {
  const { t } = useTranslation();
  const { model, locale, quickEdit } = context;
  return (
    <li className={cn('border-b last:border-b-0', selected && 'bg-accent/40')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <Checkbox
          checked={selected}
          aria-label={t('place.list.select', { entry: label })}
          className="mt-0.5"
          onCheckedChange={(checked) => onSelectChange(checked === true)}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <EntryTitle
            modelKey={model.apiKey}
            entryId={item.id}
            label={label}
            locale={locale}
            people={people}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta">
            <EntryStatusChip status={item.status} size="sm" />
            <Author author={item.author} className="max-w-40" />
            {locale ? <LocaleFlags item={item} current={locale} labelOf={context.localeLabelOf} /> : null}
            <Updated at={item.updatedAt} />
          </div>
        </div>
        <RowActions {...rowActionsProps(context, item, label)} layout="menu" />
      </div>
      {quickEdit?.openId === item.id ? (
        <div className="border-t px-4 py-5">
          <QuickEdit
            quickEdit={quickEdit}
            model={model}
            entryId={item.id}
            label={label}
            locale={locale}
            onClose={() => quickEdit.close(item.id)}
          />
        </div>
      ) : null}
    </li>
  );
};
