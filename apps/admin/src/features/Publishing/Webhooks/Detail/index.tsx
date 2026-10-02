import { useParams } from '@tanstack/react-router';
import { useWebhook } from '@/api/webhooks';
import { QueryView } from '@/components/QueryView';
import { View } from './View';

/** One webhook: send a test, its delivery log, settings, secret rotation and deletion. */
export const Detail = () => {
  const { webhookId } = useParams({ from: '/app/publishing/webhooks/$webhookId' });
  const webhook = useWebhook(webhookId);
  return (
    <QueryView query={webhook} loadingRows={6}>
      {(data) => <View webhook={data} />}
    </QueryView>
  );
};
