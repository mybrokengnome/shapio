import type { Snapshot } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { GitCompare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../Changes/hooks/useActorLabel';
import { SNAPSHOT_RUN_DISPLAY, SNAPSHOT_SOURCE_KEYS } from '../helpers/display';
import { PinPopover } from '../PinPopover';
import { RestoreButton } from '../RestoreButton';

type TableProps = {
  snapshots: Snapshot[];
  current: number;
  pinnedBy: (seq: number) => string[];
  showPins: boolean;
};

/** The ledger, newest first, deployments-style: version, when, who, what, pins, deploy, actions. */
export const Table = ({ snapshots, current, pinnedBy, showPins }: TableProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const none = t('common.none');
  return (
    <TableRoot>
      <TableHeader>
        <TableRow>
          <TableHead>{t('snapshots.fields.version')}</TableHead>
          <TableHead>{t('snapshots.fields.when')}</TableHead>
          <TableHead>{t('snapshots.fields.source')}</TableHead>
          <TableHead className="text-right">{t('snapshots.fields.entries')}</TableHead>
          <TableHead>{t('snapshots.fields.schema')}</TableHead>
          {showPins ? <TableHead>{t('snapshots.fields.pinnedBy')}</TableHead> : null}
          <TableHead>{t('snapshots.fields.deploy')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('common.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshots.map((snapshot) => {
          const pins = pinnedBy(snapshot.seq);
          const run = snapshot.deploymentRuns.at(-1);
          const runDisplay = run ? SNAPSHOT_RUN_DISPLAY[run.status] : undefined;
          return (
            <TableRow key={snapshot.seq}>
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <RowTitle asChild>
                    <Link to="/snapshots/$seq" params={{ seq: String(snapshot.seq) }}>
                      {t('snapshots.version', { seq: snapshot.seq })}
                    </Link>
                  </RowTitle>
                  {snapshot.seq === current ? (
                    <StatusChip tone="success" label={t('snapshots.live')} size="sm" />
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap" title={formatDateTime(snapshot.createdAt)}>
                {formatRelativeTime(snapshot.createdAt)}
                <span className="block text-meta text-muted-foreground">
                  {actorLabel({ type: snapshot.actor.type })}
                </span>
              </TableCell>
              <TableCell className="max-w-64">
                <Badge variant="secondary">{t(SNAPSHOT_SOURCE_KEYS[snapshot.source])}</Badge>
                {snapshot.changeSetId && snapshot.changeSetTitle ? (
                  <Link
                    to="/changes/$changeSetId"
                    params={{ changeSetId: snapshot.changeSetId }}
                    className="block truncate text-meta text-link underline-offset-4 hover:underline"
                  >
                    {snapshot.changeSetTitle}
                  </Link>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{snapshot.changedEntries}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {snapshot.schemaVersion === null
                  ? none
                  : t('snapshots.schemaVersion', { version: snapshot.schemaVersion })}
              </TableCell>
              {showPins ? (
                <TableCell className="max-w-48">
                  {pins.length > 0 ? <span className="block truncate">{pins.join(', ')}</span> : none}
                </TableCell>
              ) : null}
              <TableCell>
                {run && runDisplay ? (
                  <Link
                    to="/publishing/deployments/runs/$runId"
                    params={{ runId: run.id }}
                    className="rounded-full"
                  >
                    <StatusChip tone={runDisplay.tone} label={t(runDisplay.labelKey)} size="sm" />
                  </Link>
                ) : (
                  none
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {snapshot.seq !== current ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        to="/snapshots/$seq"
                        params={{ seq: String(current) }}
                        search={{ from: snapshot.seq }}
                        aria-label={t('snapshots.compareLabel', { seq: snapshot.seq, current })}
                      >
                        <GitCompare aria-hidden="true" />
                        {t('snapshots.compare')}
                      </Link>
                    </Button>
                  ) : null}
                  <PinPopover seq={snapshot.seq} />
                  {snapshot.seq !== current ? <RestoreButton seq={snapshot.seq} /> : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </TableRoot>
  );
};
