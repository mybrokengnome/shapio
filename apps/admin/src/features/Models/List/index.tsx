import type { DefinitionListItem } from '@shapio/client';
import { routeKeyOf } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { TableCard } from '@/components/TableCard';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { DefinitionLink } from '../DefinitionLink';
import { PendingChip } from '../PendingChip';

type ListProps = { items: DefinitionListItem[] };

/** "article · articles" for a collection (singular and list names), the API ID alone otherwise. */
const apiIdsOf = (definition: DefinitionListItem['definition']) =>
  definition.kind === 'collection' ? `${definition.apiKey} · ${routeKeyOf(definition)}` : definition.apiKey;

export const List = ({ items }: ListProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('models.columns.label')}</TableHead>
            <TableHead>{t('models.columns.apiKey')}</TableHead>
            <TableHead className="text-right">{t('models.columns.fields')}</TableHead>
            <TableHead className="text-right">{t('models.columns.version')}</TableHead>
            <TableHead>{t('models.columns.activated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(({ definition, version, activatedAt, pendingChange }) => (
            <TableRow key={definition.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <DefinitionLink definition={definition} />
                  {pendingChange ? <PendingChip changeId={pendingChange.id} /> : null}
                </span>
              </TableCell>
              <TableCell className="font-mono text-meta text-muted-foreground">
                {apiIdsOf(definition)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{definition.fields.length}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {t('models.versionNumber', { version })}
              </TableCell>
              <TableCell className="text-muted-foreground" title={formatDateTime(activatedAt)}>
                {formatRelativeTime(activatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
