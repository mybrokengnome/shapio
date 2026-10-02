import { createLazyRoute } from '@tanstack/react-router';
import { Publishing } from '@/features/Publishing';
import { Deployments } from '@/features/Publishing/Deployments';
import { Connection } from '@/features/Publishing/Deployments/Connection';
import { Run } from '@/features/Publishing/Deployments/Run';
import { Scheduled } from '@/features/Publishing/Scheduled';
import { Webhooks } from '@/features/Publishing/Webhooks';
import { Detail as WebhookDetail } from '@/features/Publishing/Webhooks/Detail';

/** Every publishing screen, loaded together on the first visit to Publishing. */
export const publishingLazyRoutes = {
  publishing: createLazyRoute('/app/publishing')({ component: Publishing }),
  scheduled: createLazyRoute('/app/publishing/scheduled')({ component: Scheduled }),
  deployments: createLazyRoute('/app/publishing/deployments')({ component: Deployments }),
  connection: createLazyRoute('/app/publishing/deployments/$connectionId')({ component: Connection }),
  run: createLazyRoute('/app/publishing/deployments/runs/$runId')({ component: Run }),
  webhooks: createLazyRoute('/app/publishing/webhooks')({ component: Webhooks }),
  webhook: createLazyRoute('/app/publishing/webhooks/$webhookId')({ component: WebhookDetail }),
};
