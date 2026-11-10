import type { DefinitionLens } from '@shapio/schema';
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
import { resolveModel, type ContentModel } from '../content/model.js';
import type { ContentIssue } from '../content/validator/issues.js';
import { AppError } from '../helpers/appError.js';
import type { ContentAction } from '../permissions/types.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import { lensUncovered, lensWriteIssues } from '../schema/errors.js';
import { activeLens, entryModelWithPolicy, type ContentServiceContext } from './contentAccess.js';
import { schemaVersionMetaOf, type SchemaVersionMeta } from './contentDeliveryLens.js';
import * as contentEntriesService from './contentEntries.js';
import type { AdminEntryView } from './contentReads.js';

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

/**
 * Today's draft of the entry in the written locale, and what the lens reads of it that the caller may read
 * today; both null when the caller cannot see the entry (the write then answers as it would without a lens).
 */
const writeBaseOf = async (
  context: ContentServiceContext,
  model: ContentModel,
  lens: DefinitionLens,
  id: string,
  locale: string | undefined,
): Promise<LensWriteBase> => {
  const definitionOf = definitionsOf(context);
  const none = { stored: null, read: null, definitionOf };
  const entry = await entriesRepository.findLive(id, model.definition.id, context.site.id, context.db);
  const policy = await context.permissions.evaluate(context.actor, {
    action: 'read',
    modelId: model.definition.id,
  });
  if (!entry || !policy.allowed || !matchesRowFilter(policy.rowFilter, context.actor, entry)) {
    return none;
  }
  const drafts = (await entryHeadsRepository.findForEntry(id, context.db)).filter(
    (head) => head.state === 'draft',
  );
  const wanted = model.definition.localized ? (locale ?? context.snapshot.defaultLocale) : drafts[0]?.locale;
  const stored = drafts.find((head) => head.locale === wanted)?.data;
  if (!isRecord(stored)) {
    return none;
  }
  const mask = rowReadMask(policy, context.actor, entry);
  const today = new Map(model.definition.fields.map((field) => [field.id, field]));
  const componentFields = new Map(
    [...model.components.values()].flatMap(({ definition }) =>
      definition.fields.map((field) => [field.id, field] as const),
    ),
  );
  const publicOnly = hidesPrivateComponentFields(mask);
  const read = readableThroughLens(
    lens,
    readThroughLens(lens, stored),
    (fieldId) => {
      const field = today.get(fieldId);
      return field !== undefined && maskAllows(mask, { ...field, deprecated: false });
    },
    (fieldId) => {
      const field = componentFields.get(fieldId);
      return field !== undefined && (field.public || !publicOnly);
    },
  );
  return { stored, read, definitionOf };
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
    if (!(error instanceof AppError) || !isRecord(error.details)) {
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
): Promise<DeliveryWriteResult> => {
  if (!activeLens(context)) {
    return toResult(context, await contentEntriesService.createEntry(context, modelKey, input));
  }
  const model = resolveModel(context.snapshot, modelKey);
  const lens = writeLens(
    context,
    model,
    new AppError(404, 'MODEL_NOT_FOUND', `No content model "${modelKey}"`),
  );
  const data = translateBody(lens, input.data, {
    stored: null,
    read: null,
    definitionOf: definitionsOf(context),
  });
  return toResult(
    context,
    await inClientNames(context, lens, () =>
      contentEntriesService.createEntry(context, modelKey, {
        ...input,
        ...(data === undefined ? {} : { data }),
      }),
    ),
  );
};

export const updateDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: DeliveryUpdateInput,
): Promise<DeliveryWriteResult> => {
  const update = (data: unknown) =>
    contentEntriesService.updateEntry(context, modelKey, id, {
      ...input,
      ...(data === undefined ? {} : { data }),
      autosave: false,
    });
  if (!activeLens(context)) {
    return toResult(context, await update(input.data));
  }
  // The entry's own kind (a family route writes the kind), under the same checks the write makes.
  const { model } = await entryModelWithPolicy(context, modelKey, id, 'update');
  const lens = writeLens(context, model, entryNotFound(id));
  const data = translateBody(lens, input.data, await writeBaseOf(context, model, lens, id, input.locale));
  return toResult(context, await inClientNames(context, lens, () => update(data)));
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
): Promise<void> => {
  if (activeLens(context)) {
    const { model } = await entryModelWithPolicy(context, modelKey, id, action);
    writeLens(context, model, entryNotFound(id));
  }
};

export const deleteDeliveryEntry = async (context: ContentServiceContext, modelKey: string, id: string) => {
  await assertEntryThroughLens(context, modelKey, id, 'delete');
  await contentEntriesService.deleteEntry(context, modelKey, id);
};
