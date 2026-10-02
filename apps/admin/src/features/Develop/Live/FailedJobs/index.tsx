import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useJobSummary } from '@/api/jobs';
import { Panel } from '@/components/Panel';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import { List } from './List';

/**
 * Background jobs only surface when something broke: the dead count and, on request, the failed jobs to
 * retry (needs `publishing.manage`). Nothing renders while every job succeeds or waits its turn.
 */
export const FailedJobs = () => {
  const { t } = useTranslation();
  const summary = useJobSummary();
  const [isOpen, setIsOpen] = useState(false);
  const dead = summary.data?.counts.dead ?? 0;
  if (dead === 0) {
    return null;
  }
  return (
    <Panel title={t('develop.live.failedJobsTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChip tone="danger" label={t('develop.live.jobsFailed', { count: dead })} size="sm" />
        <Button variant="link" size="sm" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
          {isOpen ? t('develop.live.hideFailedJobs') : t('develop.live.showFailedJobs')}
        </Button>
      </div>
      {isOpen ? <List /> : null}
    </Panel>
  );
};
