import type { AdminEntryListItem } from '@shapio/client';
import type { RowContext } from '../Row';
import { rowMoreId } from './rowIds';

/** The table's columns besides the field columns: tick box, status, author, (locale), updated, actions. */
export const fixedColumnCount = (context: RowContext) =>
  5 + (context.titleColumn ? 0 : 1) + (context.locale ? 1 : 0);

/** The row's quick actions (shared by table rows and phone rows). */
export const rowActionsProps = (context: RowContext, item: AdminEntryListItem, label: string) => {
  const { model, locale, quickEdit } = context;
  // A row read from a fallback locale has no version in this locale yet: the document creates it.
  const editable = quickEdit !== null && (locale === null || item.locale === locale);
  return {
    modelKey: model.apiKey,
    entry: item,
    label,
    locale,
    localeLabel: locale ? context.localeLabelOf(locale) : null,
    permissions: context.permissions,
    actions: context.actions,
    onPreview: context.onPreview,
    onQuickEdit: editable ? () => quickEdit.open(item.id) : undefined,
    moreId: rowMoreId(item.id),
  };
};
