import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDeploymentRuns } from '@/api/deployments';
import { CursorPager } from '@/components/CursorPager';
import { EmptyState } from '@/components/EmptyState';
import { QueryView } from '@/components/QueryView';
import { PUBLISHING_PAGE_SIZE } from '@/constants/publishing';
import { useCursorPager } from '../../hooks/useCursorPager';
import { Runs } from '../Runs';

type RunsListProps = {
  /** Runs of one connection, or of every connection when undefined. */
  connectionId: string | undefined;
  cursor: string | undefined;
  onCursorChange: (cursor: string | undefined) => void;
};

/** A page of runs (polled while any is in progress) with paging, for the body of a flush `Panel`. */
export const RunsList = ({ connectionId, cursor, onCursorChange }: RunsListProps) => {
  const { t } = useTranslation();
  const { pagerProps } = useCursorPager(cursor, onCursorChange);
  const runs = useDeploymentRuns({ connectionId, cursor, limit: PUBLISHING_PAGE_SIZE });
  return (
    <QueryView
      query={runs}
      isEmpty={(data) => data.items.length === 0 && cursor === undefined}
      empty={<EmptyState icon={Rocket} size="panel" title={t('publishing.deployments.noRuns')} />}
    >
      {(data) => (
        <>
          <Runs runs={data.items} showConnection={connectionId === undefined} />
          <CursorPager {...pagerProps(data.nextCursor)} className="border-t px-4 py-2.5" />
        </>
      )}
    </QueryView>
  );
};
