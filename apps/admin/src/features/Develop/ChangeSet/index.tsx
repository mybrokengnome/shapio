import { useParams } from '@tanstack/react-router';
import { useChangeSet } from '@/api/changeSets';
import { Page } from '@/components/Page';
import { QueryView } from '@/components/QueryView';
import { useDevelopPermissions } from '../Changes/hooks/useDevelopPermissions';
import { NoAccess } from '../Changes/NoAccess';
import { View } from './View';

/** One change set, reviewed like a pull request: its diffs, checks, consumers and timeline. */
export const ChangeSet = () => {
  const { changeSetId } = useParams({ from: '/app/changes/$changeSetId' });
  const { canManageChanges } = useDevelopPermissions();
  const set = useChangeSet(changeSetId);
  if (!canManageChanges) {
    return (
      <Page>
        <NoAccess />
      </Page>
    );
  }
  return (
    <QueryView query={set} loadingRows={6}>
      {(data) => <View set={data} />}
    </QueryView>
  );
};
