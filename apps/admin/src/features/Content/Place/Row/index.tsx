import type { AdminEntryListItem, PresencePerson } from '@shapio/client';
import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import type { FormValues } from '@/fields/helpers/values';
import { EntryStatusChip } from '../../EntryStatusChip';
import type { ContentSchema } from '../../hooks/useContentSchema';
import { Author } from '../Author';
import { Cell } from '../Cell';
import { EntryTitle } from '../EntryTitle';
import { fixedColumnCount, rowActionsProps } from '../helpers/rowContext';
import type { usePlacePermissions } from '../hooks/usePlacePermissions';
import type { useRowActions } from '../hooks/useRowActions';
import { LocaleFlags } from '../LocaleFlags';
import { QuickEdit } from '../QuickEdit';
import { RowActions } from '../RowActions';
import { Updated } from '../Updated';

export type RowContext = {
  model: ModelDefinition;
  columns: readonly FieldDefinition[];
  /** The title field, when it is one of the columns (it then carries the link). */
  titleColumn: FieldDefinition | undefined;
  /** The locale the list asked for, carried into the editor link; null for models that aren't localized. */
  locale: string | null;
  localeLabelOf: (code: string) => string;
  permissions: ReturnType<typeof usePlacePermissions>;
  actions: ReturnType<typeof useRowActions>;
  onPreview: (entryId: string) => void;
  /** The row whose quick edit is open, and its switches; null where quick edit isn't offered. */
  quickEdit: {
    schema: ContentSchema;
    openId: string | null;
    open: (id: string) => void;
    close: (id: string) => void;
    getDraft: () => FormValues | undefined;
    setDraft: (values: FormValues | undefined) => void;
  } | null;
};

export type RowProps = {
  context: RowContext;
  item: AdminEntryListItem;
  label: string;
  selected: boolean;
  people: readonly PresencePerson[];
  onSelectChange: (checked: boolean) => void;
};

/** One entry: tick box, title link with presence, field columns, status, author, locales, updated, actions. */
export const Row = ({ context, item, label, selected, people, onSelectChange }: RowProps) => {
  const { t } = useTranslation();
  const { model, columns, titleColumn, locale, quickEdit } = context;
  const title = (
    <EntryTitle modelKey={model.apiKey} entryId={item.id} label={label} locale={locale} people={people} />
  );
  return (
    <Fragment>
      <TableRow className="group/row" data-state={selected ? 'selected' : undefined}>
        <TableCell className="pl-4">
          <Checkbox
            checked={selected}
            aria-label={t('place.list.select', { entry: label })}
            onCheckedChange={(checked) => onSelectChange(checked === true)}
          />
        </TableCell>
        {titleColumn ? null : <TableCell className="max-w-96">{title}</TableCell>}
        {columns.map((field) => (
          <TableCell key={field.id} className="max-w-72 whitespace-normal">
            {field === titleColumn ? title : <Cell field={field} value={item.data[field.apiKey]} />}
          </TableCell>
        ))}
        <TableCell>
          <EntryStatusChip status={item.status} />
        </TableCell>
        <TableCell className="max-w-48">
          <Author author={item.author} />
        </TableCell>
        {locale ? (
          <TableCell>
            <LocaleFlags item={item} current={locale} labelOf={context.localeLabelOf} />
          </TableCell>
        ) : null}
        <TableCell>
          <Updated at={item.updatedAt} />
        </TableCell>
        <TableCell className="pr-4">
          <RowActions {...rowActionsProps(context, item, label)} />
        </TableCell>
      </TableRow>
      {quickEdit?.openId === item.id ? (
        <TableRow>
          <TableCell
            colSpan={fixedColumnCount(context) + columns.length}
            className="h-auto px-4 py-5 whitespace-normal"
          >
            <QuickEdit
              quickEdit={quickEdit}
              model={model}
              entryId={item.id}
              label={label}
              locale={locale}
              onClose={() => quickEdit.close(item.id)}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
};
