import type { DefinitionListItem } from '@shapio/client';
import { routeKeyOf } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { SharedGlyph } from '@/components/SharedGlyph';
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
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import { KIND_LABEL_KEYS } from '../constants';
import { DefinitionLink } from '../DefinitionLink';
import { PendingChip } from '../PendingChip';

type ListProps = {
  items: DefinitionListItem[];
  /** A Kind column, for lists that mix content types and components. */
  showKind?: boolean;
  /** Mark shared definitions with a globe (where there is more than one site); off where all are shared. */
  markShared?: boolean;
};

/** "article · articles" for a collection (singular and list names), the API ID alone otherwise. */
const apiIdsOf = (definition: DefinitionListItem['definition']) =>
  definition.kind === 'collection' ? `${definition.apiKey} · ${routeKeyOf(definition)}` : definition.apiKey;

export const List = ({ items, showKind = false, markShared = true }: ListProps) => {
  const { t } = useTranslation();
  const { multiSite } = useSchemaScopeAccess();
  const showShared = markShared && multiSite;
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('models.columns.label')}</TableHead>
            {showKind ? <TableHead>{t('models.columns.kind')}</TableHead> : null}
            <TableHead>{t('models.columns.apiKey')}</TableHead>
            <TableHead className="text-right">{t('models.columns.fields')}</TableHead>
            <TableHead className="text-right">{t('models.columns.version')}</TableHead>
            <TableHead>{t('models.columns.activated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(({ definition, scope, version, activatedAt, pendingChange }) => (
            <TableRow key={definition.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <DefinitionLink definition={definition} />
                  {showShared && scope === 'network' ? <SharedGlyph /> : null}
                  {pendingChange ? <PendingChip changeId={pendingChange.id} /> : null}
                </span>
              </TableCell>
              {showKind ? (
                <TableCell className="text-muted-foreground">{t(KIND_LABEL_KEYS[definition.kind])}</TableCell>
              ) : null}
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
