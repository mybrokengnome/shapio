import { parseDefinition, type SchemaDefinition } from '@shapio/schema';
import { AppError } from '../helpers/appError.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import * as schemaDraftsRepository from '../repositories/schemaDrafts.js';
import type { SchemaDraftRow } from '../repositories/schemaDrafts.js';
import { definitionNotFound, schemaInvalid, schemaVersionConflict } from '../schema/errors.js';
import { actorColumns } from '../schema/planner/actor.js';
import { planDraft } from './changeSetPlanning.js';
import {
  auditChangeSet,
  getChangeSet,
  lockEditable,
  touchChangeSet,
  type ChangeSetServiceContext,
} from './changeSets.js';
import {
  categoryOfKind,
  findChangeSet,
  operationOf,
  type ChangeSetActorView,
  type ChangeSetView,
  type SchemaOperation,
} from './changeSetViews.js';
import { assertCanCreate, assertCanManage } from './schemaAccess.js';
import { assertWritable } from './schemaDefinitions.js';

/**
 * A change set's schema drafts: the builder's (or schema-as-code's) proposed definition, stored mutable until
 * the set ships. Saved drafts are validated like the builder's plan endpoint, against the active schema with
 * the set's other drafts applied, and must be based on the active version (the review flags drafts that
 * become stale later; shipping refuses them).
 */
export type DefinitionCategory = 'model' | 'component';

export type SchemaDraftView = {
  id: string;
  changeSetId: string;
  definitionId: string;
  category: DefinitionCategory;
  operation: SchemaOperation;
  baseVersion: number | null;
  definition: SchemaDefinition | null;
  shared: boolean;
  version: number;
  updatedBy: ChangeSetActorView;
  createdAt: Date;
  updatedAt: Date;
};

export type PutSchemaDraftInput = {
  category: DefinitionCategory;
  definition: unknown;
  baseVersion: number | null;
  /** A new definition created shared with all sites (default: the set's site). */
  shared?: boolean | undefined;
  expectedDraftVersion?: number | undefined;
};

const draftNotFound = (definitionId: string) =>
  new AppError(404, 'SCHEMA_DRAFT_NOT_FOUND', `This change set has no draft of ${definitionId}`, {
    definitionId,
  });

const toDraftView = async (
  context: ChangeSetServiceContext,
  draft: SchemaDraftRow,
): Promise<SchemaDraftView> => {
  const type = draft.updated_by_type as ChangeSetActorView['type'];
  const names = await changeSetsRepository.findActorNames(
    {
      adminIds: type === 'admin' && draft.updated_by_id ? [draft.updated_by_id] : [],
      tokenIds: type === 'token' && draft.updated_by_id ? [draft.updated_by_id] : [],
    },
    context.db,
  );
  return {
    id: draft.id,
    changeSetId: draft.change_set_id,
    definitionId: draft.definition_id,
    category: categoryOfKind(draft.kind),
    operation: operationOf(draft),
    baseVersion: draft.base_version,
    definition: (draft.definition as SchemaDefinition | null) ?? null,
    shared: draft.shared,
    version: draft.version,
    updatedBy: {
      type: ['admin', 'token'].includes(type) ? type : 'system',
      id: draft.updated_by_id,
      name: draft.updated_by_id ? (names.get(draft.updated_by_id) ?? null) : null,
    },
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
  };
};

export const getSchemaDraft = async (
  context: ChangeSetServiceContext,
  id: string,
  definitionId: string,
): Promise<SchemaDraftView> => {
  await findChangeSet(context, id);
  const draft = await schemaDraftsRepository.findForSet(id, definitionId, context.db);
  if (!draft) {
    throw draftNotFound(definitionId);
  }
  return toDraftView(context, draft);
};

/** Parses and checks the proposal; returns what the draft row stores (normalized definition, kind, key). */
const prepareDraft = async (
  context: ChangeSetServiceContext,
  definitionId: string,
  input: PutSchemaDraftInput,
) => {
  const active = context.snapshot.byId.get(definitionId);
  if (
    (active && categoryOfKind(active.definition.kind) !== input.category) ||
    // Another site's definition is not in this set's view.
    (!active && context.snapshot.network.byId.has(definitionId))
  ) {
    throw definitionNotFound(definitionId);
  }
  const shared = !active && input.shared === true;
  await (active
    ? assertCanManage(context, definitionId)
    : assertCanCreate(context, shared ? null : context.snapshot.siteId));
  await assertWritable(context);
  const activeVersion = active?.version ?? null;
  if (input.baseVersion !== activeVersion) {
    throw schemaVersionConflict(input.baseVersion, activeVersion);
  }
  if (input.definition === null) {
    if (!active) {
      throw definitionNotFound(definitionId);
    }
    return { kind: active.definition.kind, apiKey: active.definition.apiKey, definition: null, shared };
  }
  const parsed = parseDefinition(input.definition, active ? { previous: active.definition } : {});
  if (!parsed.ok) {
    throw schemaInvalid(parsed.issues);
  }
  if (parsed.definition.id !== definitionId) {
    throw schemaInvalid([
      { path: '/id', code: 'INVALID_ID', message: 'does not match the definition in the URL' },
    ]);
  }
  if (categoryOfKind(parsed.definition.kind) !== input.category) {
    throw schemaInvalid([
      { path: '/kind', code: 'INVALID_STRUCTURE', message: `must be a ${input.category} kind` },
    ]);
  }
  return {
    kind: parsed.definition.kind,
    apiKey: parsed.definition.apiKey,
    definition: parsed.definition,
    shared,
  };
};

/**
 * Validates the proposal as planned against the set's other drafts (the schema they will form together),
 * before anything is written. Shipping plans and validates again under the schema lock.
 */
const assertPlannable = async (
  context: ChangeSetServiceContext,
  changeSetId: string,
  proposal: Pick<
    SchemaDraftRow,
    'definition_id' | 'kind' | 'api_key' | 'base_version' | 'definition' | 'shared'
  >,
) => {
  const others = (await schemaDraftsRepository.listForSet(changeSetId, context.db)).filter(
    (other) => other.definition_id !== proposal.definition_id,
  );
  const now = new Date();
  const candidate: SchemaDraftRow = {
    ...proposal,
    id: '00000000-0000-0000-0000-000000000000',
    change_set_id: changeSetId,
    version: 0,
    updated_by_type: 'system',
    updated_by_id: null,
    created_at: now,
    updated_at: now,
  };
  const planned = await planDraft(context, candidate, others);
  if (planned.issues.length > 0) {
    throw schemaInvalid(planned.issues);
  }
};

/** Creates or replaces the set's draft of one definition (optimistic concurrency on the draft row). */
export const putSchemaDraft = async (
  context: ChangeSetServiceContext,
  id: string,
  definitionId: string,
  input: PutSchemaDraftInput,
): Promise<SchemaDraftView> => {
  const prepared = await prepareDraft(context, definitionId, input);
  await assertPlannable(context, id, {
    definition_id: definitionId,
    kind: prepared.kind,
    api_key: prepared.apiKey,
    base_version: input.baseVersion,
    // Stored as JSON; the planner reads it back with readStoredDefinition.
    definition: prepared.definition as unknown as SchemaDraftRow['definition'],
    shared: prepared.shared,
  });
  const by = actorColumns(context.actor);
  const write = {
    changeSetId: id,
    definitionId,
    kind: prepared.kind,
    apiKey: prepared.apiKey,
    baseVersion: input.baseVersion,
    definition: prepared.definition,
    shared: prepared.shared,
    updatedByType: by.type,
    updatedById: by.id,
  };
  const saved = await context.db.transaction().execute(async (trx) => {
    await lockEditable(trx, context, id);
    const existing = await schemaDraftsRepository.findForSet(id, definitionId, trx);
    let draft: SchemaDraftRow | undefined;
    if (existing) {
      if (input.expectedDraftVersion === undefined) {
        throw new AppError(
          409,
          'SCHEMA_DRAFT_EXISTS',
          'This change set already has a draft of this definition',
          {
            draftVersion: existing.version,
          },
        );
      }
      draft = await schemaDraftsRepository.update(
        existing.id,
        write,
        input.expectedDraftVersion,
        new Date(),
        trx,
      );
      if (!draft) {
        throw new AppError(409, 'SCHEMA_DRAFT_CONFLICT', 'The draft changed since you loaded it', {
          expectedDraftVersion: input.expectedDraftVersion,
          currentDraftVersion: existing.version,
        });
      }
    } else {
      draft = await schemaDraftsRepository.insert(write, trx);
      if (!draft) {
        throw new AppError(
          409,
          'SCHEMA_DRAFT_EXISTS',
          'This change set already has a draft of this definition',
        );
      }
      await changeSetItemsRepository.insertSchemaItem(id, draft.id, trx);
    }
    await touchChangeSet(trx, id);
    await auditChangeSet(trx, context, id, 'change_set.schema_draft', {
      definitionId,
      apiKey: prepared.apiKey,
      operation: operationOf(draft),
      draftVersion: draft.version,
    });
    return draft;
  });
  return toDraftView(context, saved);
};

export const deleteSchemaDraft = async (
  context: ChangeSetServiceContext,
  id: string,
  definitionId: string,
): Promise<ChangeSetView> => {
  await context.db.transaction().execute(async (trx) => {
    await lockEditable(trx, context, id);
    const draft = await schemaDraftsRepository.findForSet(id, definitionId, trx);
    if (!draft) {
      throw draftNotFound(definitionId);
    }
    await schemaDraftsRepository.deleteById(draft.id, trx);
    await touchChangeSet(trx, id);
    await auditChangeSet(trx, context, id, 'change_set.schema_draft_remove', {
      definitionId,
      apiKey: draft.api_key,
    });
  });
  return getChangeSet(context, id);
};
