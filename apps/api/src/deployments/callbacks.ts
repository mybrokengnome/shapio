import { AppError } from '../helpers/appError.js';
import type { PublishingRuntime } from '../publishing/runtime.js';
import { verifySignature } from '../publishing/signature.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';
import * as deploymentRunsRepository from '../repositories/deploymentRuns.js';
import { resolveConnection } from './connections.js';
import { applyReport } from './runs.js';
import type { RunReport } from './status.js';

/**
 * Signed build callbacks from a site (generic webhook connections): `POST /api/hooks/deployments/:connectionId`
 * with `{ runId, status: building | deployed | failed, logUrl?, siteUrl?, message? }`, signed like webhooks
 * with the connection's secret. A callback can only move a run forward; an older state arriving late is
 * recorded on the timeline as ignored.
 */
export type CallbackBody = {
  runId: string;
  status: 'building' | 'deployed' | 'failed';
  logUrl?: string;
  siteUrl?: string;
  message?: string;
};

export type CallbackOutcome = { applied: boolean; status: string };

const notFound = () => new AppError(404, 'NOT_FOUND', 'Unknown connection or run');

/** Only http(s) links are kept (they are rendered as links in the admin). */
const safeLink = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const handleDeploymentCallback = async (
  runtime: PublishingRuntime,
  connectionId: string,
  request: {
    rawBody: string;
    body: CallbackBody;
    signature: string | undefined;
    timestamp: string | undefined;
  },
): Promise<CallbackOutcome> => {
  const row = await deploymentConnectionsRepository.findById(connectionId, runtime.db);
  if (!row) {
    throw notFound();
  }
  const secret = resolveConnection(runtime, row).secrets.signingSecret;
  if (!secret) {
    throw new AppError(400, 'CALLBACKS_NOT_SUPPORTED', 'This connection does not accept callbacks');
  }
  const check = verifySignature(
    secret,
    { signature: request.signature, timestamp: request.timestamp, body: request.rawBody },
    runtime.now(),
  );
  if (!check.ok) {
    throw new AppError(401, 'INVALID_SIGNATURE', `Callback rejected: ${check.reason}`);
  }
  const run = await deploymentRunsRepository.findById(request.body.runId, runtime.db);
  if (!run || run.connection_id !== connectionId) {
    throw notFound();
  }
  const report: RunReport = {
    status: request.body.status,
    message: request.body.message,
    logUrl: safeLink(request.body.logUrl),
    siteUrl: safeLink(request.body.siteUrl),
  };
  const updated = await applyReport(runtime, run.id, report, 'callback');
  if (updated) {
    return { applied: true, status: updated.status };
  }
  const current = await deploymentRunsRepository.findById(run.id, runtime.db);
  await deploymentRunsRepository.appendTimeline(
    run.id,
    {
      status: current?.status ?? run.status,
      at: runtime.now().toISOString(),
      source: 'callback',
      message: `Ignored a late "${request.body.status}" callback: the run is already ${current?.status ?? run.status}`,
    },
    runtime.now(),
    runtime.db,
  );
  return { applied: false, status: current?.status ?? run.status };
};
