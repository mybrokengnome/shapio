import { useParams } from '@tanstack/react-router';
import { useSnapshot } from '@/api/snapshots';
import { Page } from '@/components/Page';
import { QueryView } from '@/components/QueryView';
import { useDevelopPermissions } from '../../Changes/hooks/useDevelopPermissions';
import { NoAccess } from '../../Changes/NoAccess';
import { View } from './View';

/** One snapshot: what changed against an earlier one, and a time scrubber over the ledger. */
export const Detail = () => {
  const { seq } = useParams({ from: '/app/snapshots/$seq' });
  const { canManageChanges } = useDevelopPermissions();
  const snapshot = useSnapshot(Number(seq));
  if (!canManageChanges) {
    return (
      <Page>
        <NoAccess />
      </Page>
    );
  }
  return (
    <QueryView query={snapshot} loadingRows={6}>
      {(data) => <View snapshot={data} />}
    </QueryView>
  );
};
