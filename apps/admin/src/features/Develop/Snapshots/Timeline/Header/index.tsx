import type { Snapshot } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useUsers } from '@/api/users';
import { formatDateTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../../Changes/hooks/useActorLabel';

type HeaderProps = {
  seq: number;
  row: Snapshot | undefined;
  previous: number | undefined;
  /** Entries whose live content changed since `previous` (known once the thumb rests). */
  changedCount: number | undefined;
};

/** "v38 · Sep 28, 14:10 · shipped by Ada · schema v11 · 3 entries changed since v37", updated as the thumb moves. */
export const Header = ({ seq, row, previous, changedCount }: HeaderProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const users = useUsers();
  const actorName =
    row?.actor.type === 'admin' ? users.data?.find((user) => user.id === row.actor.id)?.name : undefined;
  const parts = [
    t('snapshots.version', { seq }),
    row ? formatDateTime(row.createdAt) : '',
    row ? t('snapshots.timeline.shippedBy', { name: actorName ?? actorLabel({ type: row.actor.type }) }) : '',
    row?.schemaVersion != null ? t('snapshots.schemaVersion', { version: row.schemaVersion }) : '',
    previous !== undefined && changedCount !== undefined
      ? t('snapshots.timeline.changedSince', { count: changedCount, seq: previous })
      : '',
  ].filter(Boolean);
  return (
    <p aria-live="polite" className="text-sm font-semibold tabular-nums">
      {parts.join(' · ')}
    </p>
  );
};
