import { describeStatus, isSuccessStatus, sendOutbound } from '../../publishing/outbound/request.js';
import { DELIVERY_HEADER, EVENT_HEADER, signedHeaders } from '../../publishing/signature.js';
import { runCheck, toTestResult } from '../testResult.js';
import type { DeploymentProviderAdapter, ProviderContext, RunContext } from '../types.js';

/**
 * Generic signed build webhook (brief §7 baseline): a signed POST to the site's build endpoint carrying the
 * run ID and the publication snapshot to build against. Completion is only known from the site's signed
 * callbacks (routes/hooks); without them the run honestly stays "trigger sent / completion unknown".
 * `X-Shapio-Delivery` is the run ID, so a receiver can drop a duplicate trigger after a worker retry.
 */
export const callbackPathFor = (connectionId: string) => `/api/hooks/deployments/${connectionId}`;

const post = (context: ProviderContext, body: Record<string, unknown>, event: string, deliveryId: string) => {
  const text = JSON.stringify(body);
  const url = context.connection.settings.url ?? '';
  return sendOutbound({
    url,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [EVENT_HEADER]: event,
      [DELIVERY_HEADER]: deliveryId,
      ...signedHeaders(context.connection.secrets.signingSecret ?? '', text, context.runtime.now()),
    },
    body: text,
    policy: context.policy,
    timeoutMs: context.runtime.config.outboundTimeoutMs,
    ...(context.signal ? { signal: context.signal } : {}),
  });
};

export const genericWebhookProvider: DeploymentProviderAdapter = {
  id: 'generic_webhook',
  settings: [{ name: 'url', required: true, pattern: /^https?:\/\/\S+$/ }],
  secrets: [{ name: 'signingSecret', required: true, generated: true }],
  reportsCompletion: false,
  destinations: ({ settings }) => (settings.url ? [settings.url] : []),
  trigger: async (context: RunContext) => {
    const { run, connection, runtime } = context;
    const response = await post(
      context,
      {
        type: 'deployment.trigger',
        runId: run.id,
        connectionId: connection.row.id,
        trigger: run.trigger,
        snapshot: run.snapshot_seq === null ? null : Number(run.snapshot_seq),
        schemaVersion: run.schema_version,
        triggeredAt: runtime.now().toISOString(),
        callbackUrl: runtime.urls.absoluteUrl(callbackPathFor(connection.row.id)),
        contentApiUrl: runtime.urls.absoluteUrl('/api/content'),
      },
      'deployment.trigger',
      run.id,
    );
    if (!isSuccessStatus(response.status)) {
      throw new Error(`The build endpoint answered ${describeStatus(response.status)}`);
    }
    return {
      status: 'triggered',
      message: `Trigger accepted (HTTP ${response.status}); completion is reported by the site's callbacks`,
    };
  },
  test: async (context) =>
    toTestResult([
      await runCheck('endpoint', async () => {
        const response = await post(
          context,
          { type: 'deployment.test', connectionId: context.connection.row.id },
          'deployment.test',
          `test-${context.connection.row.id}`,
        );
        if (!isSuccessStatus(response.status)) {
          throw new Error(`The build endpoint answered ${describeStatus(response.status)}`);
        }
        return `The build endpoint accepted a signed test request (HTTP ${response.status})`;
      }),
    ]),
};
