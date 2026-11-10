import { isComponentDefinition, type DefinitionLens } from '@shapio/schema';
import {
  matchesRowFilter,
  maskAllows,
  rowReadMask,
  hidesPrivateComponentFields,
} from '../content/compiler/policy.js';
import { entryNotFound } from '../content/errors.js';
import { readThroughLens } from '../content/lens/read.js';
import {
  clientApiKey,
  issuesInClientNames,
  readableThroughLens,
  writeThroughLens,
  type LensWriteBase,
} from '../content/lens/write.js';
import { writeLocaleFor } from '../content/locales.js';
import { modelNotFound, type ContentModel } from '../content/model.js';
import { visibleRelationTargetIds } from '../content/read.js';
import type { ModelValidator } from '../content/validator/index.js';
import { contentInvalid, type ContentIssue } from '../content/validator/issues.js';
import { keepUnreadableComponentFields } from '../content/write/keepUnreadable.js';
import type { ContentData } from '../db/contentData.js';
import { AppError } from '../helpers/appError.js';
import type { ContentAction } from '../permissions/types.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import { lensUncovered, lensWriteIssues } from '../schema/errors.js';
import {
  activeLens,
  entryModelWithPolicy,
  modelWithCreatePolicy,
  type ContentServiceContext,
} from './contentAccess.js';
import {
  authorizeClientRoute,
  schemaVersionMetaOf,
  type ClientRoute,
  type SchemaVersionMeta,
} from './contentDeliveryLens.js';
import { deliveryEnvironment } from './contentDeliveryReads.js';
import * as contentEntriesService from './contentEntries.js';
import type { DraftUpdateBase } from './contentEntries.js';
import type { AdminEntryView } from './contentReads.js';
import { assertMayReadDrafts } from './draftAccess.js';

/**
 * Writes through the delivery API (`POST/PUT/DELETE /api/content/:modelKey…`, build plan §4.I4): app users,
 * and anonymous callers where `public` grants it, create and change entries under their roles. The content
 * service does the work (validation, write masks, row filters, OCC, revisions); it records the app user as
 * the owner server-side, and `ownedByPrincipal` limits updates and deletes to their own entries.
 *
 * Responses carry the entry's identity and state only, never its values: the result of a write is a draft
 * (unless the model has no draft stage), and delivery never serves drafts, not even to their author.
 * Published values are read back through `GET /api/content/:modelKey/:id`.
 *
 * Through a schema lens (plan schema-lenses, limited writes) the body is in the client's version's API IDs:
 * only fields stored as the client reads them are written; any other is refused (422
 * `LENS_WRITE_UNSUPPORTED`) unless the client sent back what it read, which leaves the stored value untouched.
 * Validation errors name the client's fields. Hooks and webhooks see today's shape, as for any write.
 */
export type DeliveryWriteResult = {
  data: {
    id: string;
    locale: string;
    version: number;
    status: AdminEntryView['status'];
    createdAt: string;
    updatedAt: string;
    publishedAt: string | null;
  };
  meta: SchemaVersionMeta;
};

const toResult = (context: ContentServiceContext, view: AdminEntryView): DeliveryWriteResult => ({
  data: {
    id: view.id,
    locale: view.locale,
    version: view.version,
    status: view.status,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    publishedAt: view.publishedAt,
  },
  meta: schemaVersionMetaOf(context),
});

export type DeliveryCreateInput = { locale?: string; data?: unknown; publish?: boolean };

export type DeliveryUpdateInput = { locale?: string; expectedVersion: number | null; data?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Today's definitions by ID, as the lens's write base needs them (effective fields). */
const definitionsOf =
  (context: ContentServiceContext): LensWriteBase['definitionOf'] =>
  (id) =>
    context.snapshot.resolve(id) ?? context.snapshot.byId.get(id)?.definition;

/** The lens of the model a write lands on: 404 for a model the client's version lacks, 409 for a kind change. */
const writeLens = (
  context: ContentServiceContext,
  model: ContentModel,
  notFound: AppError,
): DefinitionLens => {
  const lens = activeLens(context)?.lensFor(model.definition.id);
  if (!lens || lens.status === 'gone') {
    throw notFound;
  }
  if (lens.status === 'uncovered') {
    throw lensUncovered(model.definition.apiKey);
  }
  return lens;
};

/** What the caller may read of an entry today, to compare a sent-back value with; null when nothing. */
type ReadScope = {
  visible: (fieldId: string) => boolean;
  componentFieldVisible: (fieldId: string) => boolean;
  /** The caller may read drafts: a draft is one of the heads it may have read. */
  readsDrafts: boolean;
};

/**
 * The read mask a sent-back comparison is limited to: what the caller may read of the entry today, so a refusal
 * never tells it whether it guessed a hidden value. Null when it may not read the entry; the write itself never
 * depends on it.
 */
const readScopeOf = async (
  context: ContentServiceContext,
  model: ContentModel,
  id: string,
): Promise<ReadScope | null> => {
  const entry = await entriesRepository.findLive(id, model.definition.id, context.site.id, context.db);
  const policy = await context.permissions.evaluate(context.actor, {
    action: 'read',
    modelId: model.definition.id,
  });
  if (!entry || !policy.allowed || !matchesRowFilter(policy.rowFilter, context.actor, entry)) {
    return null;
  }
  const mask = rowReadMask(policy, context.actor, entry);
  const today = new Map(model.definition.fields.map((field) => [field.id, field]));
  const componentFields = new Map(
    [...model.components.values()].flatMap(({ definition }) =>
      definition.fields.map((field) => [field.id, field] as const),
    ),
  );
  const publicOnly = hidesPrivateComponentFields(mask);
  const readsDrafts = await assertMayReadDrafts(context, model.definition.id, model.definition.apiKey).then(
    () => true,
    () => false,
  );
  return {
    readsDrafts,
    visible: (fieldId) => {
      const field = today.get(fieldId);
      return field !== undefined && maskAllows(mask, field);
    },
    componentFieldVisible: (fieldId) => {
      const field = componentFields.get(fieldId);
      return field !== undefined && !field.deprecated && (field.public || !publicOnly);
    },
  };
};

/**
 * What the client may have read of the entry in the written locale: the lens's read of its draft and of its
 * published head, limited to what the caller may read (empty when nothing).
 */
const readsOf = (
  lens: DefinitionLens,
  base: DraftUpdateBase,
  locale: string,
  scope: ReadScope | null,
): ContentData[] => {
  if (!scope) {
    return [];
  }
  const heads = base.heads.filter((head) => head.locale === locale);
  // Only heads this caller may read: a draft only with draft access, so a value sent back never tests a guess
  // of a draft it cannot see.
  return heads
    .filter((head) => head.state === 'published' || (head.state === 'draft' && scope.readsDrafts))
    .flatMap((head) =>
      isRecord(head.data)
        ? [
            readableThroughLens(
              lens,
              readThroughLens(lens, head.data),
              scope.visible,
              scope.componentFieldVisible,
            ),
          ]
        : [],
    );
};

/** The body in today's API IDs; one 422 naming every field that cannot be written in the client's shape. */
const translateBody = (lens: DefinitionLens, data: unknown, base: LensWriteBase): unknown => {
  if (!isRecord(data)) {
    return data;
  }
  const { input, issues } = writeThroughLens(lens, data, base);
  if (issues.length > 0) {
    throw lensWriteIssues(issues);
  }
  return input;
};

/** Today's validation and write-mask refusals, in the client's API IDs. */
const inClientNames = async <T>(
  context: ContentServiceContext,
  lens: DefinitionLens,
  write: () => Promise<T>,
): Promise<T> => {
  try {
    return await write();
  } catch (error) {
    // A lens refusal names the client's fields already.
    if (!(error instanceof AppError) || !isRecord(error.details) || error.code === 'LENS_WRITE_UNSUPPORTED') {
      throw error;
    }
    const { details } = error;
    if (Array.isArray(details.issues)) {
      const issues = issuesInClientNames(lens, details.issues as ContentIssue[], {
        definitionOf: definitionsOf(context),
      });
      throw new AppError(
        error.statusCode,
        error.code,
        error.message,
        { ...details, issues },
        { cause: error },
      );
    }
    if (error.code === 'FORBIDDEN_FIELD' && Array.isArray(details.fields)) {
      const fields = (details.fields as unknown[]).map((field) =>
        typeof field === 'string' ? clientApiKey(lens, field) : field,
      );
      throw new AppError(
        error.statusCode,
        error.code,
        error.message,
        { ...details, fields },
        { cause: error },
      );
    }
    throw error;
  }
};

export const createDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  input: DeliveryCreateInput,
  /** The client's route when the request names a schema version (`clientRouteOf`). */
  clientRoute: ClientRoute | null = null,
): Promise<DeliveryWriteResult> => {
  if (!activeLens(context)) {
    return toResult(context, await contentEntriesService.createEntry(context, modelKey, input));
  }
  // Authorized first, exactly as without a version: nothing lens-specific answers a caller that may not create.
  const { model } = await authorizeClientRoute(context, clientRoute, modelKey, (apiKey) =>
    modelWithCreatePolicy(context, apiKey),
  );
  const lens = writeLens(context, model, modelNotFound(clientRoute?.clientRouteKey ?? modelKey));
  const data = translateBody(lens, input.data, {
    stored: null,
    reads: [],
    definitionOf: definitionsOf(context),
  });
  return toResult(
    context,
    await inClientNames(context, lens, () =>
      contentEntriesService.createEntry(context, model.definition.apiKey, {
        ...input,
        ...(data === undefined ? {} : { data }),
      }),
    ),
  );
};

/**
 * The patch of a delivery update: the body (in today's names) as storage, with every component field the
 * caller cannot read carried over from the draft the write starts from, so a component written whole never
 * wipes what the caller could not see (with or without a version).
 */
const deliveryPatch = (
  context: ContentServiceContext,
  model: ContentModel,
  validator: ModelValidator,
  data: unknown,
  before: Readonly<ContentData>,
  scope: ReadScope | null,
  lens: DefinitionLens | null,
): ContentData => {
  const input = isRecord(data) ? data : {};
  const { patch, issues } = validator.fromInput(input);
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
  return keepUnreadableComponentFields(
    patch,
    before,
    model.definition.fields,
    (componentId) => {
      const definition = context.snapshot.byId.get(componentId)?.definition;
      return definition && isComponentDefinition(definition) ? definition : undefined;
    },
    (field) => scope?.componentFieldVisible(field.id) ?? false,
    { mayRead: scope !== null, input, lens },
  );
};

export const updateDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: DeliveryUpdateInput,
  clientRoute: ClientRoute | null = null,
): Promise<DeliveryWriteResult> => {
  // The entry's own kind (a family route writes the kind), authorized first, exactly as without a version.
  const { model } = await authorizeClientRoute(context, clientRoute, modelKey, (apiKey) =>
    entryModelWithPolicy(context, apiKey, id, 'update'),
  );
  const routeApiKey = clientRoute?.apiKey ?? modelKey;
  const lens = activeLens(context) ? writeLens(context, model, entryNotFound(id)) : null;
  const scope = await readScopeOf(context, model, id);
  // What a read shows of the entry's relations: a value sent back is compared without the hidden targets.
  const visibleTargets =
    lens && scope
      ? await visibleRelationTargetIds(
          deliveryEnvironment(context, context.db, { kind: 'heads', state: 'published' }, input.locale),
          model,
          (await entryHeadsRepository.findForEntry(id, context.db)).flatMap((head) =>
            isRecord(head.data) ? [head.data] : [],
          ),
        )
      : null;
  const locale = writeLocaleFor(context.snapshot, model.definition, input.locale);
  const definitionOf = definitionsOf(context);
  const write = () =>
    contentEntriesService.updateEntry(context, routeApiKey, id, {
      ...(input.locale === undefined ? {} : { locale: input.locale }),
      expectedVersion: input.expectedVersion,
      autosave: false,
      // Made from the locked draft the write starts from (a new locale's base included), inside the write.
      patchFrom: (base, { model: written, validator }) =>
        deliveryPatch(
          context,
          written,
          validator,
          lens
            ? translateBody(lens, input.data ?? {}, {
                stored: base.before,
                reads: readsOf(lens, base, base.previous?.locale ?? locale, scope),
                definitionOf,
                visibleTargets,
                mayRead: scope !== null,
                ...(scope
                  ? { readable: scope.visible, componentFieldReadable: scope.componentFieldVisible }
                  : { readable: () => false, componentFieldReadable: () => false }),
              })
            : (input.data ?? {}),
          base.before,
          scope,
          lens,
        ),
    });
  return toResult(context, lens ? await inClientNames(context, lens, write) : await write());
};

/**
 * Through a schema lens, an entry acted on by ID must be one the client's version can name: 404 for an entry of
 * a kind it lacks, 409 `LENS_UNCOVERED` for a kind change, under the same checks `action` makes. Nothing
 * without a lens. Deletes here; GraphQL's publish and unpublish too.
 */
export const assertEntryThroughLens = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  action: Extract<ContentAction, 'delete' | 'publish'>,
  clientRoute: ClientRoute | null = null,
): Promise<void> => {
  if (activeLens(context)) {
    const { model } = await authorizeClientRoute(context, clientRoute, modelKey, (apiKey) =>
      entryModelWithPolicy(context, apiKey, id, action),
    );
    writeLens(context, model, entryNotFound(id));
  }
};

export const deleteDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  clientRoute: ClientRoute | null = null,
) => {
  await assertEntryThroughLens(context, modelKey, id, 'delete', clientRoute);
  await contentEntriesService.deleteEntry(context, clientRoute?.apiKey ?? modelKey, id);
};
