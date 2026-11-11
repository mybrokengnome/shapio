import { isDeepStrictEqual } from 'node:util';
import { isComponentDefinition, type DefinitionLens } from '@shapio/schema';
import {
  matchesRowFilter,
  maskAllows,
  ownershipOfNewEntry,
  rowReadMask,
  rowWriteMask,
  hidesPrivateComponentFields,
} from '../content/compiler/policy.js';
import { contentVersionConflict, entryNotFound } from '../content/errors.js';
import { componentLookupOf, itemIdKeyOf, withItemIds } from '../content/itemIds.js';
import { readThroughLens } from '../content/lens/read.js';
import {
  clientApiKey,
  issuesInClientNames,
  readableThroughLens,
  writeThroughLens,
  type LensWriteBase,
} from '../content/lens/write.js';
import { writeLocaleFor } from '../content/locales.js';
import { modelNotFound, resolveModel, type ContentModel } from '../content/model.js';
import { visibleRelationTargetIds } from '../content/read.js';
import { buildValidator } from '../content/validator/index.js';
import { contentInvalid, type ContentIssue } from '../content/validator/issues.js';
import { itemIdTreeOf, lensLevel, todayLevel, type ItemIdTree } from '../content/write/itemIdTree.js';
import { pairComponentItems } from '../content/write/itemPairing.js';
import {
  assertComponentListCaps,
  itemViewOf,
  keepUnreadableComponentFields,
  type ComponentLookup,
} from '../content/write/keepUnreadable.js';
import type { FieldPairings } from '../content/write/listPairing.js';
import type { ContentData } from '../db/contentData.js';
import { AppError } from '../helpers/appError.js';
import type { ContentAction } from '../permissions/types.js';
import { hasUnrestrictedGrant } from '../permissions/unrestrictedGrant.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
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
import { newLocaleBase, type UpdateEntryInput } from './contentEntries.js';
import { statusOf, type AdminEntryView } from './contentReads.js';
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
    /**
     * The IDs of the component instances the body sent (plan item-ids), in the caller's API IDs, so a caller
     * that cannot read the entry can send them back (`itemIdTreeOf`). Empty when the body sent none.
     */
    itemIds?: ItemIdTree;
  };
  meta: SchemaVersionMeta;
};

const toResult = (
  context: ContentServiceContext,
  view: AdminEntryView,
  itemIds: ItemIdTree = {},
): DeliveryWriteResult => ({
  data: {
    id: view.id,
    locale: view.locale,
    version: view.version,
    status: view.status,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    publishedAt: view.publishedAt,
    itemIds,
  },
  meta: schemaVersionMetaOf(context),
});

/** Where a write records what it wrote (storage form, item IDs included), for the response's `itemIds`. */
type Written = { data: Readonly<ContentData> | null };

/** The `itemIds` of a write without a version: the body's names are today's. */
const todayItemIds = (model: ContentModel, body: unknown, written: Written): ItemIdTree => {
  if (!isRecord(body) || !written.data) {
    return {};
  }
  const componentOf = componentLookupOf(model.components);
  const byApiKey = new Map(
    [...model.components.values()].map(({ definition }) => [definition.apiKey, definition.id]),
  );
  return itemIdTreeOf(
    body,
    written.data,
    todayLevel(model.definition.fields, componentOf, (key) => byApiKey.get(key)),
  );
};

/** The `itemIds` of a write through a schema version: the body's names are the client's. */
const clientItemIds = (lens: DefinitionLens, body: unknown, written: Written): ItemIdTree =>
  isRecord(body) && written.data ? itemIdTreeOf(body, written.data, lensLevel(lens)) : {};

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
  heads: readonly HeadRecord[],
  locale: string,
  scope: ReadScope | null,
): ContentData[] => {
  if (!scope) {
    return [];
  }
  // Only heads this caller may read: a draft only with draft access, so a value sent back never tests a guess
  // of a draft it cannot see.
  return heads
    .filter((head) => head.locale === locale)
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

/**
 * The body in today's API IDs, and which stored item each component item it writes continues; one 422 naming
 * every field that cannot be written in the client's shape.
 */
const translateBody = (
  lens: DefinitionLens,
  data: unknown,
  base: LensWriteBase,
): { data: unknown; pairings: FieldPairings } => {
  if (!isRecord(data)) {
    return { data, pairings: new Map() };
  }
  const { input, issues, itemIssues, pairings } = writeThroughLens(lens, data, base);
  if (issues.length > 0) {
    throw lensWriteIssues(issues);
  }
  // Item ID and pairing refusals are today's `CONTENT_INVALID`, already in the client's API IDs.
  if (itemIssues.length > 0) {
    throw contentInvalid(itemIssues);
  }
  return { data: input, pairings };
};

/** Components by ID in today's schema, for the carry-over. */
const componentsOf =
  (context: ContentServiceContext): ComponentLookup =>
  (componentId) => {
    const definition = context.snapshot.byId.get(componentId)?.definition;
    return definition && isComponentDefinition(definition) ? definition : undefined;
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
  const written: Written = { data: null };
  const onWritten = (data: Readonly<ContentData>) => {
    written.data = data;
  };
  if (!activeLens(context)) {
    const view = await contentEntriesService.createEntry(context, modelKey, { ...input, onWritten });
    const model = resolveModel(context.snapshot, view.model);
    return toResult(context, view, todayItemIds(model, input.data, written));
  }
  // Authorized first, exactly as without a version: nothing lens-specific answers a caller that may not create.
  const { model, policy } = await authorizeClientRoute(context, clientRoute, modelKey, (apiKey) =>
    modelWithCreatePolicy(context, apiKey),
  );
  const lens = writeLens(context, model, modelNotFound(clientRoute?.clientRouteKey ?? modelKey));
  const writeMask = rowWriteMask(policy, context.actor, ownershipOfNewEntry(context.actor));
  const today = new Map(model.definition.fields.map((field) => [field.id, field]));
  const { data } = translateBody(lens, input.data, {
    stored: null,
    reads: [],
    definitionOf: definitionsOf(context),
    writable: (fieldId) => {
      const field = today.get(fieldId);
      return field !== undefined && maskAllows(writeMask, field);
    },
    writesEverything: hasUnrestrictedGrant(policy, 'write'),
  });
  const view = await inClientNames(context, lens, () =>
    contentEntriesService.createEntry(context, model.definition.apiKey, {
      ...input,
      ...(data === undefined ? {} : { data }),
      onWritten,
    }),
  );
  return toResult(context, view, clientItemIds(lens, input.data, written));
};

/** The one pairing of a delivery update, made with the body against `base` (what the write starts from). */
type Paired = { lens: DefinitionLens | null; pairings: FieldPairings; base: Readonly<ContentData> };

/**
 * The carry-over of a delivery update, run inside the write once the version is checked: component fields the
 * caller cannot read (or, through a lens, does not know or cannot write) keep their stored values, every
 * instance keeps the ID of the one it continues (`keepUnreadableComponentFields`), along the one pairing of the
 * write. That pairing was made with the body, before the write: if what the write starts from moved since (a
 * schema conversion, a new locale's shared values), the write is refused as a stale one rather than carried
 * along a pairing of other items.
 */
const carryOver =
  (
    context: ContentServiceContext,
    input: Readonly<Record<string, unknown>>,
    scope: ReadScope | null,
    paired: Paired,
    expectedVersion: number | null,
    written: Written,
  ): NonNullable<UpdateEntryInput['carry']> =>
  (patch, base, model) => {
    const moved = Object.keys(patch).some(
      (fieldId) =>
        paired.pairings.has(fieldId) && !isDeepStrictEqual(base.before[fieldId], paired.base[fieldId]),
    );
    if (moved) {
      throw contentVersionConflict(expectedVersion, base.previous?.version ?? null);
    }
    const kept = keepUnreadableComponentFields(
      patch,
      base.beforeWithIds,
      model.definition.fields,
      componentsOf(context),
      (field) => scope?.componentFieldVisible(field.id) ?? false,
      {
        mayRead: scope !== null,
        input,
        pairings: paired.pairings,
        ...(paired.lens ? { lens: paired.lens } : {}),
      },
    );
    written.data = kept;
    return kept;
  };

/** What a delivery update starts from: the written locale's draft, or a new locale's starting values. */
const writeBaseOf = (model: ContentModel, heads: readonly HeadRecord[], locale: string): ContentData => {
  const draft = heads.find((head) => head.state === 'draft' && head.locale === locale);
  return draft ? (isRecord(draft.data) ? draft.data : {}) : newLocaleBase(model, heads);
};

/**
 * Whether the caller may have read the draft a write lands on: it may read drafts, or the draft is the published
 * revision (what a write's `status` already tells it).
 */
const seesDraft = (scope: ReadScope | null, heads: readonly HeadRecord[], locale: string): boolean => {
  if (!scope) {
    return false;
  }
  if (scope.readsDrafts) {
    return true;
  }
  const draft = heads.find((head) => head.state === 'draft' && head.locale === locale);
  const published = heads.find((head) => head.state === 'published' && head.locale === locale);
  return draft !== undefined && statusOf(draft, published) === 'published';
};

/** The entry's heads, the locale written, and what the write starts from (raw, and with its items' IDs). */
const writeStartOf = async (
  context: ContentServiceContext,
  model: ContentModel,
  id: string,
  requestedLocale: string | undefined,
) => {
  const entry = await entriesRepository.findLive(id, model.definition.id, context.site.id, context.db);
  const heads = entry ? await entryHeadsRepository.findForEntry(id, context.db) : [];
  const locale = model.definition.localized
    ? writeLocaleFor(context.snapshot, model.definition, requestedLocale)
    : (heads.find((head) => head.state === 'draft')?.locale ?? context.snapshot.defaultLocale);
  const base = writeBaseOf(model, heads, locale);
  const withIds = withItemIds(base, model.definition.fields, componentsOf(context), {
    key: await itemIdKeyOf(context.db),
    entryId: id,
  });
  return { entry, heads, locale, base, withIds };
};

const sendsComponents = (model: ContentModel, patch: Readonly<ContentData>): boolean =>
  model.definition.fields.some(
    (field) => (field.type === 'component' || field.type === 'dynamiczone') && field.id in patch,
  );

/**
 * A delivery update without a schema version that sends component values: the body is mapped and checked as the
 * write would (its own 422s, the size of every component list), then its items are paired with the stored
 * ones once (their refusals, 422), all after authorization and before the write's 403 and 409.
 */
const updateWithItems = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: DeliveryUpdateInput,
  update: (data: unknown, carry?: UpdateEntryInput['carry']) => Promise<AdminEntryView>,
): Promise<DeliveryWriteResult> => {
  const { model } = await entryModelWithPolicy(context, modelKey, id, 'update');
  const body = isRecord(input.data) ? input.data : {};
  const { patch, issues } = buildValidator(context.snapshot, model).fromInput(body);
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
  if (!sendsComponents(model, patch)) {
    return toResult(context, await update(input.data));
  }
  const componentOf = componentsOf(context);
  assertComponentListCaps(patch, model.definition.fields, componentOf);
  const scope = await readScopeOf(context, model, id);
  const start = await writeStartOf(context, model, id, input.locale);
  const view = itemViewOf(componentOf, (field) => scope?.componentFieldVisible(field.id) ?? false, {
    mayRead: scope !== null,
    unseen: !seesDraft(scope, start.heads, start.locale),
  });
  const paired = pairComponentItems(patch, start.withIds, model.definition.fields, view);
  if (paired.issues.length > 0) {
    throw contentInvalid(paired.issues);
  }
  const written: Written = { data: null };
  const result = await update(
    input.data,
    carryOver(
      context,
      body,
      scope,
      { lens: null, pairings: paired.pairings, base: start.base },
      input.expectedVersion,
      written,
    ),
  );
  return toResult(context, result, todayItemIds(model, body, written));
};

export const updateDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: DeliveryUpdateInput,
  clientRoute: ClientRoute | null = null,
): Promise<DeliveryWriteResult> => {
  const update = (data: unknown, carry?: UpdateEntryInput['carry'], routeKey = modelKey) =>
    contentEntriesService.updateEntry(context, routeKey, id, {
      ...input,
      ...(data === undefined ? {} : { data }),
      autosave: false,
      ...(carry ? { carry } : {}),
    });
  if (!activeLens(context)) {
    if (!isRecord(input.data)) {
      return toResult(context, await update(input.data));
    }
    return updateWithItems(context, modelKey, id, input, (data, carry) => update(data, carry));
  }
  // The entry's own kind (a family route writes the kind), authorized first, exactly as without a version.
  const { model, policy } = await authorizeClientRoute(context, clientRoute, modelKey, (apiKey) =>
    entryModelWithPolicy(context, apiKey, id, 'update'),
  );
  const routeApiKey = clientRoute?.apiKey ?? modelKey;
  const lens = writeLens(context, model, entryNotFound(id));
  const scope = await readScopeOf(context, model, id);
  const { entry, heads, locale, base, withIds } = await writeStartOf(context, model, id, input.locale);
  // What a read shows of the entry's relations: a value sent back is compared without the hidden targets.
  const visibleTargets = scope
    ? await visibleRelationTargetIds(
        deliveryEnvironment(context, context.db, { kind: 'heads', state: 'published' }, input.locale),
        model,
        heads.flatMap((head) => (isRecord(head.data) ? [head.data] : [])),
      )
    : null;
  const writeMask = entry ? rowWriteMask(policy, context.actor, entry) : policy.writeMask;
  const today = new Map(model.definition.fields.map((field) => [field.id, field]));
  // Translated before the write, so its refusals come in today's order (422 before a stale version's 409).
  const { data, pairings } = translateBody(lens, input.data ?? {}, {
    stored: withIds,
    seesStored: seesDraft(scope, heads, locale),
    reads: readsOf(lens, heads, locale, scope),
    definitionOf: definitionsOf(context),
    visibleTargets,
    mayRead: scope !== null,
    writable: (fieldId) => {
      const field = today.get(fieldId);
      return field !== undefined && maskAllows(writeMask, field);
    },
    writesEverything: hasUnrestrictedGrant(policy, 'write'),
    ...(scope
      ? { readable: scope.visible, componentFieldReadable: scope.componentFieldVisible }
      : { readable: () => false, componentFieldReadable: () => false }),
  });
  const written: Written = { data: null };
  const result = await inClientNames(context, lens, () =>
    update(
      data,
      carryOver(
        context,
        isRecord(data) ? data : {},
        scope,
        { lens, pairings, base },
        input.expectedVersion,
        written,
      ),
      routeApiKey,
    ),
  );
  return toResult(context, result, clientItemIds(lens, input.data, written));
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
