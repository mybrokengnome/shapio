import { createHmac } from 'node:crypto';

/**
 * Signed build callbacks for Shapio's generic deployment connection: after Shapio's signed trigger started
 * a build (its body carries `runId`, `snapshot` and `callbackUrl`), the build reports `building`, then
 * `deployed` or `failed`, to `callbackUrl` (`{SHAPIO_URL}/api/hooks/deployments/<connection id>`). The body
 * is signed like Shapio's own webhooks: `X-Shapio-Signature: v1=<hex HMAC-SHA256(secret, "<ts>.<body>")>`
 * with `X-Shapio-Timestamp: <unix seconds>`, using the connection's signing secret. Shapio only moves a run
 * forward, so a late `building` never undoes `deployed`.
 */
export type CallbackStatus = 'building' | 'deployed' | 'failed';

export const CALLBACK_STATUSES: readonly CallbackStatus[] = ['building', 'deployed', 'failed'];

export type CallbackReport = {
  runId: string;
  status: CallbackStatus;
  siteUrl?: string;
  logUrl?: string;
  message?: string;
};

export const signCallback = (secret: string, body: string, now = new Date()) => {
  const timestamp = Math.floor(now.getTime() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return { 'x-shapio-timestamp': String(timestamp), 'x-shapio-signature': `v1=${signature}` };
};

/** Posts one signed report; resolves with Shapio's answer (`applied: false` for a late, older state). */
export const sendCallback = async (
  callbackUrl: string,
  secret: string,
  report: CallbackReport,
): Promise<{ applied: boolean; status: string }> => {
  const body = JSON.stringify(report);
  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signCallback(secret, body) },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shapio refused the callback: HTTP ${response.status} ${text}`);
  }
  return JSON.parse(text) as { applied: boolean; status: string };
};
