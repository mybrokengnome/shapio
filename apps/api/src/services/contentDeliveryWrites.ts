import { isComponentDefinition, type DefinitionLens, type FieldDefinition } from '@shapio/schema';
import {
  assertWritable,
  matchesRowFilter,
  maskAllows,
  ownershipOfNewEntry,
  rowReadMask,
  rowWriteMask,
  hidesPrivateComponentFields,
} from '../content/compiler/policy.js';
import { contentVersionConflict, entryNotFound } from '../content/errors.js';
import { componentLookupOf, itemIdKeyOf, itemIdScopeOf, withItemIds } from '../content/itemIds.js';
import { readThroughLens } from '../content/lens/read.js';
import {
  assertClientListCaps,
  checkClientBody,
  clientApiKey,
  issuesInClientNames,
  readableThroughLens,
  writeThroughLens,
  type LensWriteBase,
} from '../content/lens/write.js';
import { writeLocaleFor } from '../content/locales.js';
import { mediaIdsOf } from '../content/media.js';
import { modelNotFound, resolveModel, type ContentModel } from '../content/model.js';
import { readsNullThroughLens, visibleRelationTargetIds } from '../content/read.js';
import { sameContent } from '../content/sameContent.js';
import { buildValidator, isMissingValue } from '../content/validator/index.js';
import { contentInvalid, type ContentIssue } from '../content/validator/issues.js';
import {
  callerViewOf,
  componentsOfField,
  type CallerAccess,
  type CallerView,
} from '../content/write/callerView.js';
import {
  assertComponentFieldsWritable,
  forbiddenComponentFields,
} from '../content/write/componentWriteMask.js';
import { itemIdTreeOf, lensLevel, todayLevel, type ItemIdTree } from '../content/write/itemIdTree.js';
import { pairComponentItems } from '../content/write/itemPairing.js';
import {
  assertComponentListCaps,
  keepUnreadableComponentFields,
  lensFieldSet,
  type ComponentLookup,
} from '../content/write/keepUnreadable.js';
import type { FieldPairings } from '../content/write/listPairing.js';
import type { ContentData } from '../db/contentData.js';
import { AppError } from '../helpers/appError.js';
import type { ContentAction, FieldMask } from '../permissions/types.js';
import { hasUnrestrictedGrant } from '../permissions/unrestrictedGrant.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import { lensUncovered, lensWriteIssues } from '../schema/errors.js';
import {
  activeLens,
  assertEntryVisible,
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

/** An update's view and the draft head it wrote (the previous one when it changed nothing). */
type UpdateWritten = { view: AdminEntryView; head: HeadRecord | undefined };

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
  /**
   * Whether a read through a schema version shows this client field as null to the caller (`readsNullThroughLens`,
   * the read's own rule): public in the version, hidden since (private, deprecated, gone), grant unrestricted.
   */
  readsNull: (client: FieldDefinition, fieldId: string) => boolean;
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
    readsNull: (client, fieldId) => readsNullThroughLens(client, today.get(fieldId), mask, policy),
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
  const { input, issues, itemIssues, forbidden, pairings } = writeThroughLens(lens, data, base);
  if (issues.length > 0) {
    throw lensWriteIssues(issues);
  }
  // A field inside a component the caller may not write: today's 403, before anything about the items.
  if (forbidden.length > 0) {
    throw forbiddenComponentFields('Your role may not change some of these fields', forbidden);
  }
  // Item ID and pairing refusals are today's `CONTENT_INVALID`, already in the client's API IDs.
  if (itemIssues.length > 0) {
    throw contentInvalid(itemIssues);
  }
  return { data: input, pairings };
};

/**
 * Whether a delivery caller may write a field inside a component: what its audience can read (public fields,
 * never deprecated ones; plan item-ids, finding H2).
 */
const componentFieldWritableBy =
  (writeMask: FieldMask) =>
  (field: FieldDefinition): boolean =>
    !field.deprecated && (field.public || !hidesPrivateComponentFields(writeMask));

/** The same by field ID, for a write through a schema version: every component field indexed once. */
const componentFieldWritableById = (context: ContentServiceContext, writeMask: FieldMask) => {
  const writable = componentFieldWritableBy(writeMask);
  const byId = new Map<string, FieldDefinition>();
  for (const { definition } of context.snapshot.byId.values()) {
    if (isComponentDefinition(definition)) {
      definition.fields.forEach((field) => byId.set(field.id, field));
    }
  }
  return (fieldId: string): boolean => {
    const field = byId.get(fieldId);
    return field !== undefined && writable(field);
  };
};

/**
 * A body without a version, mapped to today's fields (its own 422s), with what it may not change refused:
 * top-level fields outside the write mask and fields inside components the audience cannot read (403), before
 * anything about its items is decided.
 */
const checkedBody = (
  context: ContentServiceContext,
  model: ContentModel,
  body: Readonly<Record<string, unknown>>,
  writeMask: FieldMask,
): ContentData => {
  const { patch, issues } = buildValidator(context.snapshot, model).fromInput(body);
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
  assertComponentListCaps(patch, model.definition.fields, componentsOf(context));
  assertWritable(writeMask, model.definition.fields, Object.keys(patch));
  assertComponentFieldsWritable(
    patch,
    model.definition.fields,
    componentsOf(context),
    componentFieldWritableBy(writeMask),
  );
  return patch;
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
    if (isRecord(input.data)) {
      const { model, policy } = await modelWithCreatePolicy(context, modelKey);
      checkedBody(
        context,
        model,
        input.data,
        rowWriteMask(policy, context.actor, ownershipOfNewEntry(context.actor)),
      );
    }
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
  const createBase: LensWriteBase = {
    stored: null,
    reads: [],
    definitionOf: definitionsOf(context),
    writable: (fieldId) => {
      const field = today.get(fieldId);
      return field !== undefined && maskAllows(writeMask, field);
    },
    writesEverything: hasUnrestrictedGrant(policy, 'write'),
    readsEverything: hasUnrestrictedGrant(policy, 'read'),
    componentFieldWritable: componentFieldWritableById(context, writeMask),
  };
  if (isRecord(input.data)) {
    // The body's own refusals (422), then what the caller may not set (403), as without a version.
    const checked = checkClientBody(lens, input.data, createBase);
    if (checked.issues.length > 0) {
      throw contentInvalid(checked.issues);
    }
    assertClientListCaps(lens, input.data);
    if (checked.forbidden.length > 0) {
      throw forbiddenComponentFields('Your role may not change some of these fields', checked.forbidden);
    }
  }
  const { data } = translateBody(lens, input.data, createBase);
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
    view: CallerView,
    paired: Paired,
    expectedVersion: number | null,
  ): NonNullable<UpdateEntryInput['carry']> =>
  (patch, base, model) => {
    const moved = Object.keys(patch).some(
      (fieldId) => paired.pairings.has(fieldId) && !sameContent(base.before[fieldId], paired.base[fieldId]),
    );
    if (moved) {
      throw contentVersionConflict(expectedVersion, base.previous?.version ?? null);
    }
    return keepUnreadableComponentFields(
      patch,
      base.beforeWithIds,
      model.definition.fields,
      componentsOf(context),
      () => false,
      { view, input, pairings: paired.pairings, ...(paired.lens ? { lens: paired.lens } : {}) },
    );
  };

/**
 * What a delivery caller may do with an entry (`callerView.ts`): read it at all, have read the head written, which
 * fields it reads and writes, and which relation targets and media its reads show. One answer for the write with
 * and without a version and for the carry-over.
 */
const deliveryAccessOf = async (
  context: ContentServiceContext,
  model: ContentModel,
  scope: ReadScope | null,
  writeMask: FieldMask,
  heads: readonly HeadRecord[],
  locale: string,
): Promise<CallerAccess> => {
  const documents = heads.flatMap((head) => (isRecord(head.data) ? [head.data] : []));
  // What a read on this route shows this caller: a caller that may read drafts sees draft targets too (its reads
  // can name them), anyone else the published ones.
  const visibleTargets = scope
    ? await visibleRelationTargetIds(
        deliveryEnvironment(
          context,
          context.db,
          { kind: 'heads', state: scope.readsDrafts ? 'draft' : 'published' },
          locale,
        ),
        model,
        documents,
      )
    : null;
  const mediaIds = scope ? mediaIdsOf(model, documents, model.definition.fields) : new Set<string>();
  const visibleMedia =
    scope && mediaIds.size > 0
      ? new Set(
          (await mediaAssetsRepository.findLiveManyOnSite(context.site.id, [...mediaIds], context.db)).map(
            (asset) => asset.id,
          ),
        )
      : null;
  return {
    mayRead: scope !== null,
    seesStored: seesDraft(scope, heads, locale),
    readsField: (field) => scope?.visible(field.id) ?? false,
    readsComponentField: (field) => scope?.componentFieldVisible(field.id) ?? false,
    writesComponentField: componentFieldWritableBy(writeMask),
    visibleTargets,
    visibleMedia,
    neverRefuses: false,
    readsDrafts: scope?.readsDrafts === true,
    newLocale: !heads.some((head) => head.state === 'draft' && head.locale === locale),
  };
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
  const withIds = withItemIds(
    base,
    model.definition.fields,
    componentsOf(context),
    itemIdScopeOf(await itemIdKeyOf(context.db), id, model, locale),
  );
  return { entry, heads, locale, base, withIds };
};

/**
 * The heads a caller may read on the delivery route besides the draft written, each with its items' IDs: every
 * locale's published head, and the other locales' drafts for a caller that reads drafts. The IDs its reads gave
 * it, never unknown to it where it reads them (`shownElsewhere` in content/write/listPairing.ts). None for a
 * caller that may not read the entry.
 */
const shownHeadsOf = async (
  context: ContentServiceContext,
  model: ContentModel,
  id: string,
  heads: readonly HeadRecord[],
  locale: string,
  scope: ReadScope | null,
): Promise<ContentData[]> => {
  if (!scope) {
    return [];
  }
  const key = await itemIdKeyOf(context.db);
  return heads
    .filter((head) => head.state === 'published' || (scope.readsDrafts && head.locale !== locale))
    .flatMap((head) =>
      isRecord(head.data)
        ? [
            withItemIds(
              head.data,
              model.definition.fields,
              componentsOf(context),
              itemIdScopeOf(key, id, model, head.locale),
            ),
          ]
        : [],
    );
};

/**
 * Whether a body sends a value the write may have to keep something behind: component values (items are paired and
 * what the caller cannot see is carried), and relation and media values (targets a read hid stay).
 */
const sendsCarried = (model: ContentModel, patch: Readonly<ContentData>): boolean =>
  model.definition.fields.some(
    (field) =>
      (field.type === 'component' ||
        field.type === 'dynamiczone' ||
        field.type === 'relation' ||
        field.type === 'media') &&
      field.id in patch,
  );

/** Whether a list's components hold, at any depth, a relation (`relation`) or media (`media`) field. */
const holdsFieldOfType = (view: CallerView, field: FieldDefinition, type: 'relation' | 'media'): boolean => {
  const visited = new Set<string>();
  const holds = (current: FieldDefinition): boolean =>
    componentsOfField(current, view.componentOf).some((component) => {
      if (visited.has(component.id)) {
        return false;
      }
      visited.add(component.id);
      return component.fields.some((nested) => nested.type === type || holds(nested));
    });
  return holds(field);
};

/**
 * Whether the caller sees everything stored in a list's items, at any depth: nothing in them hidden from it or
 * unknown to its version, and no relation target or media it cannot see (its read cuts those). Only there may
 * swapping identical items be an unchanged save (`isUnchangedSave`), so no answer depends on what it cannot see.
 */
const seesAllStoredOf =
  (view: CallerView) =>
  (field: FieldDefinition): boolean =>
    !view.holdsHidden({ reads: true, sees: true }, field) &&
    (view.access.visibleTargets === null || !holdsFieldOfType(view, field, 'relation')) &&
    (view.access.visibleMedia === null || !holdsFieldOfType(view, field, 'media'));

/** A stale version answers 409 before any work on the items (the write's own check stays authoritative). */
const assertFreshVersion = (
  heads: readonly HeadRecord[],
  locale: string,
  expectedVersion: number | null,
): void => {
  const draft = heads.find((head) => head.state === 'draft' && head.locale === locale);
  if (draft && draft.version !== expectedVersion) {
    throw contentVersionConflict(expectedVersion, draft.version);
  }
};

/**
 * The IDs a write answers (`itemIds`): those stored after it, read back (a write that changed nothing stored
 * nothing new; an item stored without an ID reads with the one derived for it, which the next write accepts).
 */
const storedItemIds = async (
  context: ContentServiceContext,
  model: ContentModel,
  id: string,
  written: UpdateWritten,
  body: unknown,
  level: Parameters<typeof itemIdTreeOf>[2],
): Promise<ItemIdTree> => {
  const { view, head: draft } = written;
  if (!isRecord(body) || !draft || !isRecord(draft.data)) {
    return {};
  }
  const stored = withItemIds(
    draft.data,
    model.definition.fields,
    componentsOf(context),
    itemIdScopeOf(await itemIdKeyOf(context.db), id, model, view.locale),
  );
  return itemIdTreeOf(body, stored, level);
};

const todayLevelOf = (model: ContentModel) => {
  const byApiKey = new Map(
    [...model.components.values()].map(({ definition }) => [definition.apiKey, definition.id]),
  );
  return todayLevel(model.definition.fields, componentLookupOf(model.components), (key) => byApiKey.get(key));
};

/**
 * A delivery update without a schema version that sends component values. In order: the body's shape (422),
 * what the caller may not change (403), a stale version (409), then its items paired with the stored ones once
 * (422), all before the write, which checks the version again.
 */
const updateWithItems = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: DeliveryUpdateInput,
  update: (data: unknown, carry?: UpdateEntryInput['carry'], view?: CallerView) => Promise<UpdateWritten>,
): Promise<DeliveryWriteResult> => {
  const { model, policy } = await entryModelWithPolicy(context, modelKey, id, 'update');
  const body = isRecord(input.data) ? input.data : {};
  const start = await writeStartOf(context, model, id, input.locale);
  // Existence and the row filter answer first, exactly as the write itself would (404, never an item issue).
  const entry = assertEntryVisible(policy, context.actor, start.entry, id);
  const writeMask = rowWriteMask(policy, context.actor, entry);
  const patch = checkedBody(context, model, body, writeMask);
  if (!sendsCarried(model, patch)) {
    return toResult(context, (await update(input.data)).view);
  }
  assertFreshVersion(start.heads, start.locale, input.expectedVersion);
  const scope = await readScopeOf(context, model, id);
  const view = callerViewOf(
    await deliveryAccessOf(context, model, scope, writeMask, start.heads, start.locale),
    componentsOf(context),
  );
  const shown = await shownHeadsOf(context, model, id, start.heads, start.locale, scope);
  const paired = pairComponentItems(patch, start.withIds, model.definition.fields, view, shown);
  if (paired.issues.length > 0) {
    throw contentInvalid(paired.issues);
  }
  const result = await update(
    input.data,
    carryOver(
      context,
      body,
      view,
      { lens: null, pairings: paired.pairings, base: start.base },
      input.expectedVersion,
    ),
    view,
  );
  return toResult(
    context,
    result.view,
    await storedItemIds(context, model, id, result, body, todayLevelOf(model)),
  );
};

export const updateDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: DeliveryUpdateInput,
  clientRoute: ClientRoute | null = null,
): Promise<DeliveryWriteResult> => {
  const update = (data: unknown, carry?: UpdateEntryInput['carry'], routeKey = modelKey, view?: CallerView) =>
    contentEntriesService.updateEntryWithHead(context, routeKey, id, {
      ...input,
      ...(data === undefined ? {} : { data }),
      autosave: false,
      ...(carry ? { carry } : {}),
      ...(view ? { seesAllStoredIn: seesAllStoredOf(view) } : {}),
    });
  if (!activeLens(context)) {
    if (!isRecord(input.data)) {
      return toResult(context, (await update(input.data)).view);
    }
    return updateWithItems(context, modelKey, id, input, (data, carry, view) =>
      update(data, carry, modelKey, view),
    );
  }
  // The entry's own kind (a family route writes the kind), authorized first, exactly as without a version.
  const { model, policy } = await authorizeClientRoute(context, clientRoute, modelKey, (apiKey) =>
    entryModelWithPolicy(context, apiKey, id, 'update'),
  );
  const routeApiKey = clientRoute?.apiKey ?? modelKey;
  const lens = writeLens(context, model, entryNotFound(id));
  const { entry: found, heads, locale, base, withIds } = await writeStartOf(context, model, id, input.locale);
  // Existence and the row filter answer first, exactly as without a version.
  const entry = assertEntryVisible(policy, context.actor, found, id);
  const writeMask = rowWriteMask(policy, context.actor, entry);
  const scope = await readScopeOf(context, model, id);
  const access = await deliveryAccessOf(context, model, scope, writeMask, heads, locale);
  const view = callerViewOf(access, componentsOf(context), lensFieldSet(lens));
  const today = new Map(model.definition.fields.map((field) => [field.id, field]));
  const body = isRecord(input.data) ? input.data : {};
  const writeBase: LensWriteBase = {
    stored: withIds,
    shown: await shownHeadsOf(context, model, id, heads, locale, scope),
    seesStored: access.seesStored,
    reads: readsOf(lens, heads, locale, scope),
    definitionOf: definitionsOf(context),
    visibleTargets: access.visibleTargets,
    mayRead: access.mayRead,
    writable: (fieldId) => {
      const field = today.get(fieldId);
      return field !== undefined && maskAllows(writeMask, field);
    },
    writesEverything: hasUnrestrictedGrant(policy, 'write'),
    readsEverything: hasUnrestrictedGrant(policy, 'read'),
    componentFieldWritable: componentFieldWritableById(context, writeMask),
    view,
    ...(scope
      ? { readable: scope.visible, componentFieldReadable: scope.componentFieldVisible }
      : { readable: () => false, componentFieldReadable: () => false }),
  };
  // In the order a body without a version is answered: the body's own refusals (422), what the caller may not
  // change (403), a stale version (409), then the version's refusals and the items' with the translation.
  const checked = checkClientBody(lens, body, writeBase);
  if (checked.issues.length > 0) {
    throw contentInvalid(checked.issues);
  }
  assertClientListCaps(lens, body);
  // A top-level field the version's read shows as null (hidden since) sent back as that null is the read sent
  // back: left out, its stored value kept, as inside components. Any other value keeps its refusal.
  const sent = Object.keys(body).flatMap((key) => {
    const field = lens.fields.find((candidate) => candidate.apiKey === key);
    if (!field || field.kind === 'null') {
      return [];
    }
    const echo = isMissingValue(body[key]) && scope !== null && scope.readsNull(field.client, field.fieldId);
    return echo ? [] : [field];
  });
  await inClientNames(context, lens, async () =>
    assertWritable(
      writeMask,
      model.definition.fields,
      sent.map((field) => field.fieldId),
    ),
  );
  if (checked.forbidden.length > 0) {
    throw forbiddenComponentFields('Your role may not change some of these fields', checked.forbidden);
  }
  if (sent.some((field) => field.client.type === 'component' || field.client.type === 'dynamiczone')) {
    assertFreshVersion(heads, locale, input.expectedVersion);
  }
  const { data, pairings } = translateBody(lens, input.data ?? {}, writeBase);
  const result = await inClientNames(context, lens, () =>
    update(
      data,
      carryOver(context, isRecord(data) ? data : {}, view, { lens, pairings, base }, input.expectedVersion),
      routeApiKey,
      view,
    ),
  );
  return toResult(
    context,
    result.view,
    await storedItemIds(context, model, id, result, input.data, lensLevel(lens)),
  );
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
