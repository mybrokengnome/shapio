import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HealthRule } from '../content/health/rules.js';
import * as contentCountsService from '../services/contentCounts.js';
import * as contentHealthReadsService from '../services/contentHealthReads.js';
import * as contentPreflightService from '../services/contentPreflight.js';
import * as editorPresenceService from '../services/editorPresence.js';
import { contentContextFor } from './contentContext.js';

/** The entry document's endpoints: pre-flight, the Inbox's findings, presence and per-model counts. */
type ModelParams = { modelKey: string };
type EntryParams = ModelParams & { id: string };

type PreflightRequest = FastifyRequest<{ Params: EntryParams; Body: { locales?: string[] } }>;
type FindingsRequest = FastifyRequest<{
  Querystring: { rule?: HealthRule; modelKey?: string; cursor?: string; limit?: number };
}>;
type HeartbeatRequest = FastifyRequest<{
  Params: EntryParams;
  Body: { tabId: string; locale?: string | null };
}>;
type LeaveRequest = FastifyRequest<{ Params: EntryParams; Querystring: { tabId: string } }>;

/** Sidebar counts change slowly; a browser may reuse them for a minute. */
const COUNTS_MAX_AGE_SECONDS = 60;

export const runPreflight = async (request: PreflightRequest) =>
  contentPreflightService.runPreflight(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    {
      ...request.body,
      staleDays: request.server.config.health.staleDays,
    },
  );

export const listFindings = async (request: FindingsRequest) =>
  contentHealthReadsService.listFindings(await contentContextFor(request), request.query);

export const summarizeFindings = async (request: FastifyRequest) =>
  contentHealthReadsService.summarizeFindings(await contentContextFor(request));

export const heartbeat = async (request: HeartbeatRequest) =>
  editorPresenceService.heartbeat(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    request.body,
  );

export const entryPresence = async (request: FastifyRequest<{ Params: EntryParams }>) =>
  editorPresenceService.entryPresence(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
  );

export const modelPresence = async (request: FastifyRequest<{ Params: ModelParams }>) =>
  editorPresenceService.modelPresence(await contentContextFor(request), request.params.modelKey);

export const leavePresence = async (request: LeaveRequest, reply: FastifyReply) => {
  await editorPresenceService.leave(await contentContextFor(request), request.params.id, request.query.tabId);
  return reply.code(204).send();
};

export const countContent = async (request: FastifyRequest, reply: FastifyReply) =>
  reply
    .header('cache-control', `private, max-age=${COUNTS_MAX_AGE_SECONDS}`)
    .send(await contentCountsService.countContent(await contentContextFor(request)));
