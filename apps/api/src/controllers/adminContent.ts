import type { FastifyReply, FastifyRequest } from 'fastify';
import * as contentEntriesService from '../services/contentEntries.js';
import * as contentPublishingService from '../services/contentPublishing.js';
import * as contentReadsService from '../services/contentReads.js';
import { contentContextFor, rawQueryOf } from './contentContext.js';

type ModelParams = { modelKey: string };
type EntryParams = ModelParams & { id: string };
type RevisionParams = EntryParams & { revisionId: string };
type LocaleQuery = { locale?: string };

type CreateRequest = FastifyRequest<{
  Params: ModelParams;
  Body: { locale?: string; data?: Record<string, unknown>; publish?: boolean };
}>;
type GetRequest = FastifyRequest<{ Params: EntryParams; Querystring: LocaleQuery }>;
type UpdateRequest = FastifyRequest<{
  Params: EntryParams;
  Body: {
    locale?: string;
    expectedVersion: number | null;
    data?: Record<string, unknown>;
    autosave?: boolean;
  };
}>;
type LocalesRequest = FastifyRequest<{ Params: EntryParams; Body: { locales?: string[] } }>;
type RevisionsRequest = FastifyRequest<{ Params: EntryParams; Querystring: LocaleQuery }>;
type RevisionRequest = FastifyRequest<{ Params: RevisionParams }>;
type RestoreRequest = FastifyRequest<{ Params: RevisionParams; Body: { expectedVersion: number } }>;

const revisionSummary = (row: Awaited<ReturnType<typeof contentReadsService.listRevisions>>[number]) => ({
  id: row.id,
  locale: row.locale,
  reason: row.reason,
  schemaRevisionId: row.schema_revision_id,
  authorType: row.author_type,
  authorId: row.author_id,
  parentRevisionId: row.parent_revision_id,
  createdAt: row.created_at.toISOString(),
});

export const listEntries = async (request: FastifyRequest<{ Params: ModelParams }>) =>
  contentReadsService.listAdminEntries(
    await contentContextFor(request),
    request.params.modelKey,
    rawQueryOf(request),
  );

export const createEntry = async (request: CreateRequest, reply: FastifyReply) =>
  reply
    .code(201)
    .send(
      await contentEntriesService.createEntry(
        await contentContextFor(request),
        request.params.modelKey,
        request.body,
      ),
    );

export const getEntry = async (request: GetRequest) =>
  contentReadsService.getAdminEntry(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    request.query.locale,
  );

export const updateEntry = async (request: UpdateRequest) =>
  contentEntriesService.updateEntry(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    request.body,
  );

export const deleteEntry = async (request: FastifyRequest<{ Params: EntryParams }>, reply: FastifyReply) => {
  await contentEntriesService.deleteEntry(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
  );
  return reply.code(204).send();
};

export const duplicateEntry = async (request: FastifyRequest<{ Params: EntryParams }>, reply: FastifyReply) =>
  reply
    .code(201)
    .send(
      await contentEntriesService.duplicateEntry(
        await contentContextFor(request),
        request.params.modelKey,
        request.params.id,
      ),
    );

export const publishEntry = async (request: LocalesRequest) =>
  contentPublishingService.publishEntry(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    request.body,
  );

export const unpublishEntry = async (request: LocalesRequest) =>
  contentPublishingService.unpublishEntry(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    request.body,
  );

export const listRevisions = async (request: RevisionsRequest) => ({
  items: (
    await contentReadsService.listRevisions(
      await contentContextFor(request),
      request.params.modelKey,
      request.params.id,
      request.query.locale,
    )
  ).map(revisionSummary),
});

export const getRevision = async (request: RevisionRequest) => {
  const { revision, data } = await contentReadsService.getRevision(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    request.params.revisionId,
  );
  return { ...revisionSummary(revision), data };
};

export const restoreRevision = async (request: RestoreRequest) =>
  contentEntriesService.restoreRevision(
    await contentContextFor(request),
    request.params.modelKey,
    request.params.id,
    request.params.revisionId,
    request.body,
  );
