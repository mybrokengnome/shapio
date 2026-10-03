import type { FastifyReply, FastifyRequest } from 'fastify';
import { assistDisabled } from '../assist/errors.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type {
  AltTextBody,
  ContentOpsBody,
  RewriteBody,
  RunParams,
  SchemaDraftBody,
  SummarizeBody,
  TranslateBody,
} from '../routes/admin/assist/schemas.js';
import { writeAltText } from '../services/assist/altText.js';
import { getContentOpsRun, proposeContentOps } from '../services/assist/contentOps.js';
import type { AssistServiceContext } from '../services/assist/context.js';
import { rewriteText } from '../services/assist/rewrite.js';
import { draftSchema } from '../services/assist/schemaDraft.js';
import { getAssistStatus } from '../services/assist/status.js';
import { summarizeEntry } from '../services/assist/summarize.js';
import { translateEntry } from '../services/assist/translate.js';
import { contentContextFor } from './contentContext.js';

const runtimeOf = (request: FastifyRequest) => {
  const runtime = request.server.assist;
  if (!runtime) {
    throw assistDisabled();
  }
  return runtime;
};

/** An abort signal that fires when the client goes away before the answer is sent. */
const signalFor = (reply: FastifyReply): AbortSignal => {
  const controller = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
};

const assistContextFor = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AssistServiceContext> => ({
  ...(await contentContextFor(request)),
  assist: runtimeOf(request),
  storage: request.server.mediaStorage,
  signal: signalFor(reply),
});

const lightContextOf = (request: FastifyRequest) => ({
  db: request.server.db,
  site: getRequestSite(request),
  actor: request.principal,
  permissions: request.server.permissions,
});

export const getStatus = (request: FastifyRequest) =>
  getAssistStatus(lightContextOf(request), request.server.assist);

export const altText = async (request: FastifyRequest<{ Body: AltTextBody }>, reply: FastifyReply) =>
  writeAltText(await assistContextFor(request, reply), request.body);

export const summarize = async (request: FastifyRequest<{ Body: SummarizeBody }>, reply: FastifyReply) =>
  summarizeEntry(await assistContextFor(request, reply), request.body);

export const translate = async (request: FastifyRequest<{ Body: TranslateBody }>, reply: FastifyReply) =>
  translateEntry(await assistContextFor(request, reply), request.body);

export const rewrite = async (request: FastifyRequest<{ Body: RewriteBody }>, reply: FastifyReply) =>
  rewriteText(await assistContextFor(request, reply), request.body);

export const schemaDraft = async (request: FastifyRequest<{ Body: SchemaDraftBody }>, reply: FastifyReply) =>
  draftSchema(await assistContextFor(request, reply), request.body);

export const proposeContentOpsRun = async (
  request: FastifyRequest<{ Body: ContentOpsBody }>,
  reply: FastifyReply,
) => {
  const run = await proposeContentOps(await contentContextFor(request), runtimeOf(request), request.body);
  return reply.code(202).send(run);
};

export const getContentOpsRunView = (request: FastifyRequest<{ Params: RunParams }>) =>
  getContentOpsRun(lightContextOf(request), request.params.runId);
