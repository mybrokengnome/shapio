import { useParams } from '@tanstack/react-router';
import { useDeploymentRun } from '@/api/deployments';
import { QueryView } from '@/components/QueryView';
import { View } from './View';

/** One deployment run, polled until it finishes. */
export const Run = () => {
  const { runId } = useParams({ from: '/app/publishing/deployments/runs/$runId' });
  const run = useDeploymentRun(runId);
  return (
    <QueryView query={run} loadingRows={6}>
      {(data) => <View run={data} />}
    </QueryView>
  );
};
