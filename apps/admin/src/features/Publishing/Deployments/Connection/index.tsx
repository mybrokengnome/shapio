import { useParams } from '@tanstack/react-router';
import { useDeploymentConnection } from '@/api/deployments';
import { QueryView } from '@/components/QueryView';
import { View } from './View';

/** One deployment connection. */
export const Connection = () => {
  const { connectionId } = useParams({ from: '/app/publishing/deployments/$connectionId' });
  const connection = useDeploymentConnection(connectionId);
  return (
    <QueryView query={connection} loadingRows={6}>
      {(data) => <View connection={data} />}
    </QueryView>
  );
};
