import type { DeploymentConnection } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useDeleteDeploymentConnection,
  useTestDeploymentConnection,
  useTriggerDeployment,
} from '@/api/deployments';

/** Test the connection (result shown inline), trigger a manual run (opens it) and delete (a promise, for its confirmation). */
export const useConnectionActions = (connection: DeploymentConnection) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const test = useTestDeploymentConnection();
  const trigger = useTriggerDeployment();
  const remove = useDeleteDeploymentConnection();
  return {
    testResult: test.data,
    testing: test.isPending,
    triggering: trigger.isPending,
    deleting: remove.isPending,
    runTest: () => test.mutate(connection.id),
    triggerRun: () =>
      trigger.mutate(connection.id, {
        onSuccess: (run) => {
          toast.success(t('publishing.deployments.triggered'));
          void navigate({ to: '/publishing/deployments/runs/$runId', params: { runId: run.id } });
        },
      }),
    remove: () =>
      remove.mutateAsync(connection.id, {
        onSuccess: () => {
          toast.success(t('publishing.deployments.deleted', { name: connection.name }));
          void navigate({ to: '/publishing/deployments' });
        },
      }),
  };
};
