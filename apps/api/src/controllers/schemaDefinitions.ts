import type { FastifyReply, FastifyRequest } from 'fastify';
import * as schemaDefinitionsService from '../services/schemaDefinitions.js';
import type { DefinitionCategory } from '../services/schemaDefinitions.js';
import * as schemaScopeService from '../services/schemaScope.js';
import { schemaContextFor, toActiveDefinitionResponse, toChangeJobResponse } from './schemaContext.js';

type Ack = { acknowledgeBreaking?: boolean; acknowledgeDestructive?: boolean };
type IdParams = { id: string };
type Scope = schemaDefinitionsService.DefinitionScope;
type ListRequest = FastifyRequest<{ Querystring: { scope?: Scope } }>;
type CreateRequest = FastifyRequest<{ Body: { definition: unknown; scope?: Scope } & Ack }>;
type CreatePlanRequest = FastifyRequest<{ Body: { definition: unknown; scope?: Scope } }>;
type UpdateRequest = FastifyRequest<{
  Params: IdParams;
  Body: { definition: unknown; expectedVersion: number } & Ack;
}>;
type UpdatePlanRequest = FastifyRequest<{
  Params: IdParams;
  Body: { definition: unknown; expectedVersion: number };
}>;
type ScopeRequest = FastifyRequest<{
  Params: IdParams;
  Body: { scope: Scope; siteId?: string; version: number };
}>;
type DeleteRequest = FastifyRequest<{ Params: IdParams; Querystring: { expectedVersion: number } }>;
type ByIdRequest = FastifyRequest<{ Params: IdParams }>;
type RevisionRequest = FastifyRequest<{ Params: IdParams & { revisionId: string } }>;

const statusCodeFor = (outcome: schemaDefinitionsService.ChangeOutcome) =>
  outcome.status === 'pending' ? 202 : 200;

/** Handlers for one definition category; models and components mount the same set. */
export const createDefinitionControllers = (category: DefinitionCategory) => ({
  list: async (request: ListRequest) => {
    const items = await schemaDefinitionsService.listDefinitions(
      await schemaContextFor(request),
      category,
      request.query.scope,
    );
    return {
      items: items.map(({ active, pendingChange }) => ({
        ...toActiveDefinitionResponse(active),
        pendingChange: pendingChange ? { id: pendingChange.id, status: pendingChange.status } : null,
      })),
    };
  },

  get: async (request: ByIdRequest) => {
    const { active, pendingChange } = await schemaDefinitionsService.getDefinition(
      await schemaContextFor(request),
      category,
      request.params.id,
    );
    return {
      ...toActiveDefinitionResponse(active),
      pendingChange: pendingChange ? toChangeJobResponse(pendingChange) : null,
    };
  },

  create: async (request: CreateRequest, reply: FastifyReply) => {
    const { definition, scope, ...ack } = request.body;
    const outcome = await schemaDefinitionsService.applyChange(await schemaContextFor(request), {
      category,
      definition,
      expectedVersion: null,
      ...(scope ? { scope } : {}),
      ...ack,
    });
    return reply.code(outcome.status === 'pending' ? 202 : 201).send(outcome);
  },

  planCreate: async (request: CreatePlanRequest) =>
    schemaDefinitionsService.previewChange(await schemaContextFor(request), {
      category,
      definition: request.body.definition,
      expectedVersion: null,
      ...(request.body.scope ? { scope: request.body.scope } : {}),
    }),

  update: async (request: UpdateRequest, reply: FastifyReply) => {
    const { definition, expectedVersion, ...ack } = request.body;
    const outcome = await schemaDefinitionsService.applyChange(await schemaContextFor(request), {
      category,
      id: request.params.id,
      definition,
      expectedVersion,
      ...ack,
    });
    return reply.code(statusCodeFor(outcome)).send(outcome);
  },

  planUpdate: async (request: UpdatePlanRequest) =>
    schemaDefinitionsService.previewChange(await schemaContextFor(request), {
      category,
      id: request.params.id,
      definition: request.body.definition,
      expectedVersion: request.body.expectedVersion,
    }),

  changeScope: async (request: ScopeRequest) =>
    schemaScopeService.changeScope(await schemaContextFor(request), {
      category,
      id: request.params.id,
      scope: request.body.scope,
      siteId: request.body.siteId,
      expectedVersion: request.body.version,
    }),

  remove: async (request: DeleteRequest, reply: FastifyReply) => {
    const outcome = await schemaDefinitionsService.deleteDefinition(await schemaContextFor(request), {
      category,
      id: request.params.id,
      expectedVersion: request.query.expectedVersion,
    });
    return reply.code(statusCodeFor(outcome)).send(outcome);
  },

  listRevisions: async (request: ByIdRequest) => {
    const rows = await schemaDefinitionsService.listRevisions(
      await schemaContextFor(request),
      category,
      request.params.id,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        version: row.version,
        hash: row.hash,
        parentRevisionId: row.parent_revision_id,
        createdByType: row.created_by_type,
        createdById: row.created_by_id,
        createdAt: row.created_at.toISOString(),
      })),
    };
  },

  getRevision: async (request: RevisionRequest) => {
    const row = await schemaDefinitionsService.getRevision(
      await schemaContextFor(request),
      category,
      request.params.id,
      request.params.revisionId,
    );
    return {
      id: row.id,
      version: row.version,
      hash: row.hash,
      parentRevisionId: row.parent_revision_id,
      createdByType: row.created_by_type,
      createdById: row.created_by_id,
      createdAt: row.created_at.toISOString(),
      definition: row.definition,
    };
  },

  listChanges: async (request: ByIdRequest) => {
    const rows = await schemaDefinitionsService.listChanges(
      await schemaContextFor(request),
      category,
      request.params.id,
    );
    return { items: rows.map(toChangeJobResponse) };
  },
});
