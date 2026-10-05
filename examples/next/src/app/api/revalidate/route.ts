import { webhookSecret } from '../../../lib/config';
import { log } from '../../../lib/log';
import { revalidateChanges, revalidateEveryPage } from '../../../lib/revalidation';
import { REVALIDATING_EVENTS, SITE_WIDE_EVENTS } from '../../../lib/revalidationTargets';
import { readWebhookEvent } from '../../../lib/webhookEvent';

/**
 * POST /api/revalidate/ (with the slash: `trailingSlash` redirects the other form, and Shapio's webhooks do not
 * follow redirects): the target of the Shapio webhook the seed creates (publish, unpublish, delete,
 * change set shipped, schema change, site settings). A signed delivery refreshes the pages whose content changed since the
 * snapshot the site shows (src/lib/revalidation.ts). A failure answers 500, so Shapio retries the delivery.
 */
export const POST = async (request: Request) => {
  const read = await readWebhookEvent(request, webhookSecret());
  if (!read.ok) {
    log(`Refused a webhook delivery: ${read.reason}`);
    return Response.json({ error: read.reason }, { status: read.status });
  }
  const { event } = read;
  if (!REVALIDATING_EVENTS.includes(event.type)) {
    return Response.json({ event: event.type, ignored: true });
  }
  try {
    if (SITE_WIDE_EVENTS.includes(event.type)) {
      return Response.json({ event: event.type, ...revalidateEveryPage() });
    }
    return Response.json({ event: event.type, ...(await revalidateChanges()) });
  } catch (error) {
    log(
      `Revalidation for ${event.type} ${event.id} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return Response.json({ error: 'revalidation failed' }, { status: 500 });
  }
};
