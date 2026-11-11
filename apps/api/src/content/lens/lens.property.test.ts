import {
  canonicalJson,
  compileLens,
  createDefinitionIndex,
  lensEffects,
  normalizeDefinition,
  RICHTEXT_FORMAT,
  richTextToPlainText,
  type RichTextDocument,
  storageFamilyOf,
  validateSchema,
  type DefinitionLens,
  type FieldDefinition,
  type FieldLens,
  type ComponentDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  changeArb,
  componentById,
  contentModelOf,
  dataArb,
  definitionsOf,
  describeVersions,
  evolve,
  fieldsById,
  headsArb,
  lensBetween,
  migrate,
  MODEL_ID,
  replay,
  replayHeads,
  schemaArb,
  snapshotOf,
  TRANSPARENT_OPS,
  transparentChangeArb,
  validatorOf,
  type Change,
  type Schema,
} from '../../../test/helpers/lensArbitraries.js';
import {
  instanceIssues,
  isEmptyApiValue,
  walkDelivered,
  withoutItemIds,
  withoutStoredItemIds,
} from '../../../test/helpers/lensOracles.js';
import type { ContentData } from '../../db/contentData.js';
import { AppError } from '../../helpers/appError.js';
import { plainNumber } from '../../helpers/plainNumber.js';
import type { FieldMask, Policy } from '../../permissions/types.js';
import type { HeadRow } from '../compiler/compile.js';
import { maskAllows } from '../compiler/policy.js';
import type { QueryTree } from '../compiler/querystring.js';
import { withItemIds } from '../itemIds.js';
import { projectRows, type ReadEnvironment } from '../read.js';
import { COMPONENT_KEY } from '../validator/index.js';
import type { ContentIssue } from '../validator/issues.js';
import { canonicalDate, canonicalDatetime, canonicalTime } from '../validator/scalars.js';
import { pairComponentItems } from '../write/itemPairing.js';
import { itemViewOf, keepUnreadableComponentFields } from '../write/keepUnreadable.js';
import type { FieldPairings } from '../write/listPairing.js';
import { rewriteQueryTree } from './query.js';
import { readThroughLens } from './read.js';
import { exactNumberText, MAX_EXACT_NUMBER_LENGTH, MAX_NUMBER_EXPONENT } from './values.js';
import { readableThroughLens, writeThroughLens } from './write.js';

/**
 * Property-based tests that try to break schema lenses (plan schema-lenses, ADR 0015). Generators and the
 * migration through the real planner live in `test/helpers/lensArbitraries.ts`; the independent API-shape
 * oracle in `test/helpers/lensOracles.ts`. Every projection here goes through the real `projectRows` of
 * `content/read.ts` (the lensed projection), with the admin audience so no database is needed: relation
 * visibility and media views are the only parts that differ by audience, and none of the lens code does.
 */

/** 500 by default; `LENS_PROPERTY_RUNS=5000` for a longer hunt. */
const RUNS = Number(process.env.LENS_PROPERTY_RUNS ?? 500);
/** `LENS_PROPERTY_SEED=<n>` replays a run (fast-check prints the seed of a failure). */
if (process.env.LENS_PROPERTY_SEED !== undefined) {
  fc.configureGlobal({ seed: Number(process.env.LENS_PROPERTY_SEED) });
}

// ---------------------------------------------------------------------------------------------------------
// Harness

const row = (data: ContentData): HeadRow => ({
  entry_id: '00000000-0000-4000-8000-00000000e000',
  model_id: MODEL_ID,
  locale: 'en',
  data,
  version: 1,
  revision_id: '00000000-0000-4000-8000-00000000e002',
  updated_at: new Date(0),
  autosaved_at: null,
  created_at: new Date(0),
  entry_updated_at: new Date(0),
  created_by_admin_id: null,
  owner_app_user_id: null,
});

/** Masks made from a grant that names no fields (`deliveryMask`): the policy's `unrestrictedFields`. */
const WILDCARD_MASKS = new WeakSet<FieldMask>();

const policyOf = (readMask: FieldMask): Policy => ({
  allowed: true,
  rowFilter: null,
  readMask,
  rowReadMasks: null,
  writeMask: { mode: 'all' },
  rowWriteMasks: null,
  ...(WILDCARD_MASKS.has(readMask) ? { unrestrictedFields: { read: true, write: true } } : {}),
});

const ALL: FieldMask = { mode: 'all' };

/** The item-ID key of these tests (an instance's is random, from the database). */
const ITEM_ID_TEST_KEY = Buffer.alloc(32);
/** The entry ID the harness writes and reads (`row`'s). */
const ENTRY_ID = '00000000-0000-4000-8000-00000000e000';

/**
 * The read mask a wildcard delivery grant gets (`combineFieldMasks` over `createSchemaFieldVisibility`): the
 * model's public, non-deprecated fields; public component fields only.
 */
const deliveryMask = (schema: Schema): FieldMask => {
  const mask: FieldMask = {
    mode: 'only',
    fieldIds: schema.model.fields
      .filter((field) => field.public && !field.deprecated)
      .map((field) => field.id),
    componentFields: 'public',
  };
  WILDCARD_MASKS.add(mask);
  return mask;
};

const componentsOf = (schema: Schema) => (id: string) => componentById(schema, id);

/** What a client on `client` reads of `data` stored under `today`, through the real lensed projection. */
const projectThrough = async (
  today: Schema,
  client: Schema | null,
  data: ContentData,
  mask: FieldMask = ALL,
  /** Keep the item `id` of every component instance (default: values only, for comparing values). */
  { ids = false }: { ids?: boolean } = {},
): Promise<Record<string, unknown>> => {
  const todayIndex = createDefinitionIndex(definitionsOf(today));
  const env = {
    executor: {} as never,
    snapshot: snapshotOf(today),
    permissions: {} as never,
    actor: { kind: 'anonymous' } as never,
    siteId: '00000000-0000-4000-8000-00000000e001',
    audience: 'admin',
    source: { kind: 'heads', state: 'draft' },
    locale: undefined,
    // The instance key derived item IDs are made with (a fixed one: no database).
    itemIdKey: ITEM_ID_TEST_KEY,
    ...(client
      ? {
          lens: {
            view: snapshotOf(client),
            lensFor: (id: string) =>
              compileLens(todayIndex, createDefinitionIndex(definitionsOf(client)), id),
            selection: null,
          },
        }
      : {}),
  } as ReadEnvironment;
  const [projected] = await projectRows(env, contentModelOf(today), policyOf(mask), [row(data)], {
    fields: null,
    populate: new Map(),
  });
  const output = projected?.data ?? {};
  const shape = client ?? today;
  return ids ? output : withoutItemIds(shape.model, output, componentsOf(shape));
};

/** V, the change sequence's versions, and data generated valid for today's (last) version and for V. */
const historyArb = (changes: fc.Arbitrary<Change> = changeArb, min = 1) =>
  schemaArb.chain((start) =>
    fc.array(changes, { minLength: min, maxLength: 6 }).chain((sequence) => {
      const versions = evolve(start, sequence);
      const today = versions[versions.length - 1] as Schema;
      return fc.record({
        versions: fc.constant(versions),
        sequence: fc.constant(sequence),
        todayData: dataArb(today),
        clientData: dataArb(start),
      });
    }),
  );

/** V data migrated through the real activations of the sequence (refused activations skipped). */
const migratedArb = (changes: fc.Arbitrary<Change> = changeArb) =>
  schemaArb.chain((start) =>
    fc.record({
      start: fc.constant(start),
      data: dataArb(start),
      sequence: fc.array(changes, { minLength: 1, maxLength: 6 }),
    }),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The text of a string or a rich-text document; undefined for anything else. */
const plainTextOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  return isRecord(value) && value.format === RICHTEXT_FORMAT
    ? richTextToPlainText(value as RichTextDocument)
    : undefined;
};

/** Whether some list anywhere in `stored` holds both values. */
const inOneStoredList = (stored: unknown, a: unknown, b: unknown): boolean => {
  if (Array.isArray(stored)) {
    return (stored.includes(a) && stored.includes(b)) || stored.some((item) => inOneStoredList(item, a, b));
  }
  return isRecord(stored) && Object.values(stored).some((item) => inOneStoredList(item, a, b));
};

/**
 * Whether `direct` holds at least what `replay` does: equal scalars; every item of a scalar list; objects key by
 * key; lists of objects position by position (a replay through a single value keeps the first item only).
 */
const subsumes = (direct: unknown, replay: unknown, stored: unknown): boolean => {
  if (isEmptyApiValue(replay)) {
    return true;
  }
  // A list read as one value: the direct lens takes the first item that fits, a replay may keep another one.
  // Neither is less; both must be items of one stored list.
  if (typeof direct === 'string' && typeof replay === 'string' && inOneStoredList(stored, direct, replay)) {
    return true;
  }
  if (Array.isArray(direct) && Array.isArray(replay)) {
    if (replay.every((item) => typeof item !== 'object' || item === null)) {
      const kept = new Set(direct.map((item) => canonicalJson(item)));
      return replay.every((item) => kept.has(canonicalJson(item)));
    }
    // Items in order, the replay's a subsequence of the direct read's: a replay drops whole items (a zone item
    // of a component an intermediate version did not allow) that the direct lens keeps.
    let position = 0;
    return replay.every((item) => {
      while (position < direct.length && !subsumes(direct[position], item, stored)) {
        position += 1;
      }
      position += 1;
      return position <= direct.length;
    });
  }
  if (isRecord(direct) && isRecord(replay)) {
    return Object.keys(replay).every((key) => subsumes(direct[key], replay[key], stored));
  }
  return canonicalJson(direct) === canonicalJson(replay);
};

const fieldsByIdOf = (definition: { fields: readonly FieldDefinition[] }) =>
  new Map(definition.fields.map((field) => [field.id, field]));

const last = <T>(items: readonly T[]): T => items[items.length - 1] as T;

// ---------------------------------------------------------------------------------------------------------

describe('schema lens properties', { timeout: 300_000 }, () => {
  it('1. identity: compileLens(D, D) is an identity and reads data back unchanged', () => {
    fc.assert(
      fc.property(
        schemaArb.chain((schema) => fc.tuple(fc.constant(schema), dataArb(schema))),
        ([schema, data]) => {
          const lens = lensBetween(schema, schema);
          expect(lens.status).toBe('identity');
          for (const component of schema.components) {
            expect(lensBetween(schema, schema, component.id).status).toBe('identity');
          }
          expect(readThroughLens(lens, data)).toEqual(data);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('2. shape soundness: a lensed read is always V-shaped API output (data valid today)', async () => {
    await fc.assert(
      fc.asyncProperty(historyArb(), async ({ versions, todayData }) => {
        const [client, today] = [versions[0] as Schema, last(versions)];
        const projected = await projectThrough(today, client, todayData, ALL, { ids: true });
        expect(
          instanceIssues(client.model, projected, componentsOf(client), ''),
          `${describeVersions(versions)}\n  stored ${JSON.stringify(todayData)}`,
        ).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('2b. shape soundness: V data migrated through the real activations reads V-shaped', async () => {
    await fc.assert(
      fc.asyncProperty(migratedArb(), async ({ start, data, sequence }) => {
        const history = replay(start, sequence, data);
        const projected = await projectThrough(last(history.versions), start, last(history.data), ALL, {
          ids: true,
        });
        expect(
          instanceIssues(start.model, projected, componentsOf(start), ''),
          `${describeVersions(history.versions)}\n  data ${JSON.stringify(history.data)}`,
        ).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('2c. shape soundness: the storage-form lens output passes the client validator (shape issues only)', () => {
    const SHAPE_CODES = new Set([
      'INVALID_TYPE',
      'INVALID_FORMAT',
      'NOT_ALLOWED',
      'UNKNOWN_COMPONENT',
      'INVALID_RICHTEXT',
    ]);
    fc.assert(
      fc.property(historyArb(), ({ versions, todayData }) => {
        const [client, today] = [versions[0] as Schema, last(versions)];
        const read = readThroughLens(lensBetween(today, client), todayData);
        const issues = validatorOf(client)
          .validate(read, { skipRequired: true })
          .issues.filter((issue) => SHAPE_CODES.has(issue.code));
        expect(issues, `${describeVersions(versions)}\n  stored ${JSON.stringify(todayData)}`).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('2d. every locale of an entry, migrated (localization, drafts, required defaults), reads V-shaped and keeps its own values', async () => {
    await fc.assert(
      fc.asyncProperty(
        schemaArb.chain((start) =>
          fc.record({
            start: fc.constant(start),
            heads: headsArb(start),
            sequence: fc.array(changeArb, { minLength: 1, maxLength: 6 }),
            transparent: fc.boolean(),
          }),
        ),
        async ({ start, heads, sequence, transparent }) => {
          const changes = transparent
            ? sequence.filter((change) => TRANSPARENT_OPS.includes(change.op))
            : sequence;
          const history = replayHeads(start, changes, heads);
          const today = last(history.versions);
          const todayFields = fieldsById(today);
          const message = `${describeVersions(history.versions)}\n  heads ${JSON.stringify(history.heads)}`;
          for (const [locale, data] of Object.entries(last(history.heads))) {
            const projected = await projectThrough(today, start, data, ALL, { ids: true });
            expect(
              instanceIssues(start.model, projected, componentsOf(start), ''),
              `${locale}: ${message}`,
            ).toEqual([]);
            const resurrected: string[] = [];
            walkDelivered(start.model, projected, componentsOf(start), (field, value, path) => {
              if (!todayFields.has(field.id) && !isEmptyApiValue(value)) {
                resurrected.push(path);
              }
            });
            expect(resurrected, `${locale}: ${message}`).toEqual([]);
            const original = heads[locale];
            if (transparent && original) {
              const before = await projectThrough(start, null, original, deliveryMask(start));
              const after = await projectThrough(today, start, data, deliveryMask(today));
              expect(after, `${locale}: ${message}`).toEqual(before);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('3. no resurrection: a field removed since V (or re-added under its API ID) reads empty', async () => {
    await fc.assert(
      fc.asyncProperty(historyArb(), async ({ versions, todayData }) => {
        const [client, today] = [versions[0] as Schema, last(versions)];
        const todayFields = fieldsById(today);
        const projected = await projectThrough(today, client, todayData);
        const resurrected: string[] = [];
        walkDelivered(client.model, projected, componentsOf(client), (field, value, path) => {
          if (!todayFields.has(field.id) && !isEmptyApiValue(value)) {
            resurrected.push(`${path} = ${JSON.stringify(value)}`);
          }
        });
        expect(resurrected, `${describeVersions(versions)}\n  stored ${JSON.stringify(todayData)}`).toEqual(
          [],
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('4. rename transparency: renames, reorders, relabels and additions read exactly as V did', async () => {
    await fc.assert(
      fc.asyncProperty(migratedArb(transparentChangeArb), async ({ start, data, sequence }) => {
        const history = replay(start, sequence, data);
        const today = last(history.versions);
        const before = await projectThrough(start, null, data, deliveryMask(start));
        const after = await projectThrough(today, start, last(history.data), deliveryMask(today));
        expect(
          after,
          `${describeVersions(history.versions)}\n  data ${JSON.stringify(history.data)}`,
        ).toEqual(before);
      }),
      { numRuns: RUNS },
    );
  });

  /**
   * What is tested of ADR 0015's "a replay can only add loss": the direct lens returns a value wherever a
   * step-by-step replay does, equal up to the spelling of the same value. Allowed differences, each recorded:
   * a field read untouched (`same`) where the replay canonicalized it; a list read as one value taking another
   * item of the same stored list; a replay that dropped whole items (N); one number spelled two ways, plain or
   * in rich text, the replay's float rounding included (R, seed 3708); one time or date spelled two ways (T).
   */
  it('5. monotonic loss: the direct lens returns a value wherever a replay does, equal up to spelling', async () => {
    await fc.assert(
      fc.asyncProperty(historyArb(changeArb, 2), async ({ versions, todayData }) => {
        const client = versions[0] as Schema;
        const today = last(versions);
        const direct = readThroughLens(lensBetween(today, client), todayData);
        let stepped: ContentData = todayData;
        for (let index = versions.length - 1; index > 0; index -= 1) {
          stepped = readThroughLens(
            lensBetween(versions[index] as Schema, versions[index - 1] as Schema),
            stepped,
          );
        }
        // Both in V's API shape (projection without a lens: the data is V's storage form).
        const directOut = await projectThrough(client, null, { ...direct });
        const steppedOut = await projectThrough(client, null, { ...stepped });
        expect(
          instanceIssues(
            client.model,
            await projectThrough(client, null, { ...direct }, ALL, { ids: true }),
            componentsOf(client),
            '',
          ),
          `${describeVersions(versions)}\n  stored ${JSON.stringify(todayData)}`,
        ).toEqual([]);
        const problems = client.model.fields.flatMap((field) => {
          const a = directOut[field.apiKey];
          const b = steppedOut[field.apiKey];
          // A field whose stored values fit the client as they are reads them untouched; a replay through a
          // type that canonicalizes ("10:30:00" → "10:30:00.000" through time) changes the text, not the value.
          const unchanged =
            lensBetween(today, client).fields.find((lens) => lens.fieldId === field.id)?.kind === 'same';
          if (isEmptyApiValue(b) || (unchanged && !isEmptyApiValue(a))) {
            return [];
          }
          if (isEmptyApiValue(a) && knownFloatReplay(todayData[field.id], b)) {
            return [];
          }
          if (isEmptyApiValue(a)) {
            return [`${field.apiKey}: replay keeps ${JSON.stringify(b)}, direct lens reads empty`];
          }
          if (canonicalJson(a) === canonicalJson(b)) {
            return [];
          }
          // Known, recorded as example R: one number spelled two ways as text ("5e-324" / "0.000…5"), plain or
          // in rich text. Also the replay's own loss: a hop through a number rounds "99999999999999999999" to
          // "100000000000000000000" (seed 3708), while the direct read keeps the exact digits.
          const [textA, textB] = [plainTextOf(a), plainTextOf(b)];
          // Known, recorded as example T: one time (or date) spelled two ways ("10:30" / "10:30:00.000").
          if (
            textA !== undefined &&
            textB !== undefined &&
            [canonicalTime, canonicalDate, canonicalDatetime].some(
              (canonical) => canonical(textA) !== undefined && canonical(textA) === canonical(textB),
            )
          ) {
            return [];
          }
          if (
            textA !== undefined &&
            textB !== undefined &&
            textA.trim() !== '' &&
            Number(textA) === Number(textB)
          ) {
            return [];
          }
          // ADR 0015: a replay can only add loss. A list the replay cut short (a list → one → list hop), at
          // any depth, is the replay's loss, not the direct lens's.
          if (subsumes(a, b, todayData)) {
            return [];
          }
          return [`${field.apiKey}: direct ${JSON.stringify(a)} ≠ replay ${JSON.stringify(b)}`];
        });
        expect(problems, `${describeVersions(versions)}\n  stored ${JSON.stringify(todayData)}`).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  const maskArb = (today: Schema): fc.Arbitrary<FieldMask> =>
    fc.oneof(
      fc.constant<FieldMask>({ mode: 'all' }),
      fc.constant(deliveryMask(today)),
      fc.record({
        mode: fc.constant('only' as const),
        fieldIds: fc.subarray(today.model.fields.map((field) => field.id)),
        componentFields: fc.constantFrom('public' as const, 'all' as const),
      }),
    );

  /** Leaks of `projected` (client shape) against today's visibility. */
  const visibilityLeaks = (
    client: Schema,
    today: Schema,
    mask: FieldMask,
    projected: Record<string, unknown>,
  ) => {
    const todayModel = fieldsByIdOf(today.model);
    const todayAll = fieldsById(today);
    const leaks: string[] = [];
    for (const field of client.model.fields) {
      const current = todayModel.get(field.id);
      const value = projected[field.apiKey];
      if (current && !maskAllows(mask, { ...current, deprecated: false }) && !isEmptyApiValue(value)) {
        leaks.push(`/${field.apiKey}: hidden today, present as ${JSON.stringify(value)}`);
      }
    }
    const publicOnly = mask.mode === 'only' && mask.componentFields === 'public';
    walkDelivered(client.model, projected, componentsOf(client), (field, value, path) => {
      if (path.split('/').length <= 2) {
        return;
      }
      const current = todayAll.get(field.id)?.field;
      if (publicOnly && current && !current.public && !isEmptyApiValue(value)) {
        leaks.push(`${path}: private component field today, delivered ${JSON.stringify(value)}`);
      }
    });
    return leaks;
  };

  it('6. visibility never widens (data valid today)', async () => {
    await fc.assert(
      fc.asyncProperty(
        historyArb().chain((history) => fc.tuple(fc.constant(history), maskArb(last(history.versions)))),
        async ([{ versions, todayData }, mask]) => {
          const [client, today] = [versions[0] as Schema, last(versions)];
          const projected = await projectThrough(today, client, todayData, mask);
          expect(
            visibilityLeaks(client, today, mask, projected),
            `${describeVersions(versions)}\n  mask ${JSON.stringify(mask)}\n  stored ${JSON.stringify(todayData)}`,
          ).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('6b. visibility never widens (an old revision read at a snapshot: V data, unmigrated)', async () => {
    await fc.assert(
      fc.asyncProperty(
        historyArb().chain((history) => fc.tuple(fc.constant(history), maskArb(last(history.versions)))),
        async ([{ versions, clientData }, mask]) => {
          const [client, today] = [versions[0] as Schema, last(versions)];
          const projected = await projectThrough(today, client, clientData, mask);
          expect(
            visibilityLeaks(client, today, mask, projected),
            `${describeVersions(versions)}\n  mask ${JSON.stringify(mask)}\n  stored ${JSON.stringify(clientData)}`,
          ).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Queries

const SYSTEM_NAMES = ['id', 'createdAt', 'updatedAt'];

type QueryParts = { filters?: QueryTree; sort?: string[]; fields?: string[]; populate?: string[] };

const queryArb = (client: Schema, today: Schema): fc.Arbitrary<QueryParts> => {
  // V's names, today's names the client never had, system attributes and one name nobody has.
  const names = [
    ...new Set([
      ...client.model.fields.map((field) => field.apiKey),
      ...today.model.fields.map((field) => field.apiKey),
      ...SYSTEM_NAMES,
      'nope',
    ]),
  ];
  const leaf = fc
    .tuple(
      fc.constantFrom(...names),
      fc.constantFrom('$eq', '$ne', '$null', '$in', '$contains'),
      fc.constantFrom('x', 'true', '3'),
    )
    .map(([name, operator, value]): QueryTree => ({ [name]: { [operator]: value } }));
  const { tree } = fc.letrec<{ tree: QueryTree }>((tie) => ({
    tree: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      leaf,
      fc.tuple(leaf, leaf).map(([a, b]): QueryTree => ({ ...a, ...b })),
      fc.tuple(tie('tree'), tie('tree')).map(([a, b]): QueryTree => ({ $and: { 0: a, 1: b } })),
      fc.tuple(tie('tree'), tie('tree')).map(([a, b]): QueryTree => ({ $or: { 0: a, 1: b } })),
      tie('tree').map((a): QueryTree => ({ $not: a })),
    ),
  }));
  const relations = client.model.fields
    .filter((field) => field.type === 'relation')
    .map((field) => field.apiKey);
  return fc.record(
    {
      filters: tree,
      sort: fc
        .subarray(names, { maxLength: Math.min(3, names.length) })
        .map((keys) => keys.map((key, index) => `${key}:${index % 2 ? 'desc' : 'asc'}`)),
      fields: fc.subarray(
        names.filter((name) => !SYSTEM_NAMES.includes(name)),
        { minLength: 1, maxLength: Math.min(4, names.length - SYSTEM_NAMES.length) },
      ),
      populate: fc.subarray([...relations, ...relations.map((key) => `${key}.name`), 'nope'], {
        minLength: 1,
        maxLength: Math.min(3, 2 * relations.length + 1),
      }),
    },
    { requiredKeys: [] },
  );
};

/** Where a rewritten filter names another field than the client's, or a condition went missing. */
const filterMismatches = (
  client: Schema,
  today: Schema,
  original: QueryTree,
  rewritten: QueryTree,
  path = 'filters',
): string[] => {
  const clientIds = new Map(client.model.fields.map((field) => [field.apiKey, field.id]));
  const todayIds = new Map(today.model.fields.map((field) => [field.apiKey, field.id]));
  const problems: string[] = [];
  const originalKeys = Object.keys(original);
  if (originalKeys.length !== Object.keys(rewritten).length) {
    problems.push(`${path}: ${originalKeys.length} keys became ${Object.keys(rewritten).length}`);
  }
  for (const key of originalKeys) {
    const value = original[key] as QueryTree;
    if (key === '$and' || key === '$or') {
      const children = rewritten[key] as QueryTree | undefined;
      for (const index of Object.keys(value)) {
        problems.push(
          ...filterMismatches(
            client,
            today,
            value[index] as QueryTree,
            (children?.[index] ?? {}) as QueryTree,
            `${path}.${key}.${index}`,
          ),
        );
      }
    } else if (key === '$not') {
      problems.push(
        ...filterMismatches(client, today, value, (rewritten[key] ?? {}) as QueryTree, `${path}.$not`),
      );
    } else if (SYSTEM_NAMES.includes(key)) {
      if (!(key in rewritten)) {
        problems.push(`${path}.${key}: system attribute dropped`);
      }
    } else {
      const fieldId = clientIds.get(key);
      const match = Object.keys(rewritten).find(
        (candidate) => fieldId !== undefined && todayIds.get(candidate) === fieldId,
      );
      if (fieldId === undefined) {
        problems.push(`${path}.${key}: a name the client's version does not have was accepted`);
      } else if (match === undefined) {
        problems.push(
          `${path}.${key}: no condition on the same field (#${fieldId.slice(-4)}) in ${JSON.stringify(Object.keys(rewritten))}`,
        );
      } else if (canonicalJson(rewritten[match]) !== canonicalJson(value)) {
        problems.push(`${path}.${key}: operand changed`);
      } else {
        const before = client.model.fields.find((field) => field.id === fieldId) as FieldDefinition;
        const after = today.model.fields.find((field) => field.id === fieldId) as FieldDefinition;
        if (storageFamilyOf(before) !== storageFamilyOf(after)) {
          problems.push(`${path}.${key}: filters across storage families (${before.type} → ${after.type})`);
        }
      }
    }
  }
  return problems;
};

describe('schema lens properties: queries', { timeout: 300_000 }, () => {
  it('7. query rewrite soundness: same fields by stable ID, or LENS_QUERY_UNSUPPORTED; never a dropped filter', () => {
    fc.assert(
      fc.property(
        historyArb().chain((history) =>
          fc.tuple(fc.constant(history), queryArb(history.versions[0] as Schema, last(history.versions))),
        ),
        ([{ versions }, query]) => {
          const [client, today] = [versions[0] as Schema, last(versions)];
          const lens = lensBetween(today, client);
          const context = { lensFor: (id: string) => lensBetween(today, client, id) };
          const message = `${describeVersions(versions)}\n  query ${JSON.stringify(query)}`;
          let result;
          try {
            result = rewriteQueryTree(lens, query, context);
          } catch (error) {
            expect(error, message).toBeInstanceOf(AppError);
            expect(['LENS_QUERY_UNSUPPORTED', 'INVALID_QUERY'], message).toContain((error as AppError).code);
            return;
          }
          const problems: string[] = [];
          if (query.filters) {
            problems.push(
              ...filterMismatches(client, today, query.filters, result.tree.filters as QueryTree),
            );
          }
          const clientIds = new Map(client.model.fields.map((field) => [field.apiKey, field.id]));
          const todayIds = new Map(today.model.fields.map((field) => [field.apiKey, field.id]));
          const sameField = (clientKey: string, todayKey: string) =>
            SYSTEM_NAMES.includes(clientKey)
              ? clientKey === todayKey
              : clientIds.get(clientKey) === todayIds.get(todayKey);
          if (query.sort) {
            const sorted = (result.tree.sort ?? []) as string[];
            if (sorted.length !== query.sort.length) {
              problems.push(`sort: ${query.sort.length} terms became ${sorted.length}`);
            }
            query.sort.forEach((term, index) => {
              const [clientKey = '', direction] = term.split(':');
              const [todayKey = '', todayDirection] = (sorted[index] ?? '').split(':');
              if (!sameField(clientKey, todayKey) || direction !== todayDirection) {
                problems.push(`sort ${term} became ${sorted[index]}`);
              }
            });
          }
          if (query.fields) {
            expect(result.selectedFieldIds, message).toEqual(query.fields.map((key) => clientIds.get(key)));
            for (const todayKey of (result.tree.fields ?? []) as string[]) {
              if (!query.fields.some((clientKey) => sameField(clientKey, todayKey))) {
                problems.push(`fields: ${todayKey} is not one the client named`);
              }
            }
          }
          if (query.populate) {
            for (const path of (result.tree.populate ?? []) as string[]) {
              const [todayKey = ''] = path.split('.');
              if (!query.populate.some((clientPath) => sameField(clientPath.split('.')[0] ?? '', todayKey))) {
                problems.push(`populate: ${path} names a relation the client did not`);
              }
            }
          }
          expect(problems, message).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Writes

const definitionOfToday = (today: Schema) => {
  const index = createDefinitionIndex(definitionsOf(today));
  return (id: string) => index.resolve(id) ?? index.get(id);
};

/** A field the lens writes as sent (mirrors the rule `writeThroughLens` documents: `same`, same localization). */
const isWritable = (field: FieldLens): boolean =>
  field.kind === 'same' &&
  field.client.localized === field.stored.localized &&
  (field.client.type !== 'component' ||
    ['identity', 'lensed'].includes(
      field.nested?.components.get(field.client.settings.component)?.status ?? '',
    ));

/** A patch over a document, exactly as `contentEntries.applyPatch` does it: null clears, anything else replaces. */
const applyPatch = (base: Readonly<ContentData>, patch: Readonly<ContentData>): ContentData => {
  const output: ContentData = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete output[key];
    } else {
      output[key] = value;
    }
  }
  return output;
};

/** A value with empty fields (null, [], absent) removed from every object inside it. */
const withoutEmpties = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutEmpties);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => !isEmptyApiValue(item))
        .map(([key, item]) => [key, withoutEmpties(item)]),
    );
  }
  return value;
};

/**
 * `now` limited to what `was` shows, at every depth: a field hidden at V and shown since (made public or no
 * longer deprecated: visibility is today's) is not a change of value.
 */
const shownAt = (now: unknown, was: unknown): unknown => {
  if (Array.isArray(now) && Array.isArray(was)) {
    return now.map((item, index) => shownAt(item, was[index]));
  }
  if (isRecord(now) && isRecord(was)) {
    return Object.fromEntries(
      Object.entries(now)
        .filter(([key]) => key in was)
        .map(([key, item]) => [key, shownAt(item, was[key])]),
    );
  }
  return now;
};

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** Today's components by ID, as the write path looks them up. */
const componentLookup = (schema: Schema) => (componentId: string) =>
  componentById(schema, componentId) as ComponentDefinition | undefined;

/** The stored data with an ID on every component instance (stored, or derived), as a write starts from it. */
const storedWithIds = (schema: Schema, stored: Readonly<ContentData>): ContentData =>
  withItemIds(stored, schema.model.fields, componentLookup(schema), {
    key: ITEM_ID_TEST_KEY,
    entryId: ENTRY_ID,
  });

type DeliveryWrite = {
  today: Schema;
  /** The client's version; null: no version named. */
  client: Schema | null;
  stored: ContentData;
  body: Record<string, unknown>;
  /** The caller may read the entry. */
  mayRead: boolean;
  /** The caller may have read the draft it writes (draft access, or the draft is the published revision). */
  seesStored?: boolean;
  /** Top-level fields the caller reads today. */
  readable: (fieldId: string) => boolean;
  /** Component fields (any depth) the caller reads today. */
  componentReadable: (fieldId: string) => boolean;
};

type DeliveryWriteOutcome = {
  /** Who refused, or null when written. */
  refusedBy: 'lens' | 'items' | 'fromInput' | null;
  issues: ContentIssue[];
  /** The lens's translation, when a version was named. */
  result: ReturnType<typeof writeThroughLens> | null;
  /** The patch as carried over (storage form, `__id` on every instance), merged over the stored data. */
  written: ContentData | null;
  /** The fields the patch names (what `assertWritable` checks against the write mask). */
  patched: readonly string[];
};

/**
 * A delivery update as `contentDeliveryWrites` runs it (plan item-ids): what the write starts from gets an ID on
 * every component instance (`withItemIds`); through a version the lens translates the body and pairs its items
 * once (`writeThroughLens`), otherwise the mapped body is paired once (`pairComponentItems`); item refusals are
 * 422s; the carry-over follows that one pairing (`keepUnreadableComponentFields`).
 */
const deliveryWrite = (write: DeliveryWrite): DeliveryWriteOutcome => {
  const { today, client, stored, body, mayRead, readable, componentReadable } = write;
  const componentOf = componentLookup(today);
  const withIds = storedWithIds(today, stored);
  const seesStored = write.seesStored ?? true;
  let input = body;
  let pairings: FieldPairings | undefined;
  let result: ReturnType<typeof writeThroughLens> | null = null;
  const lens = client ? lensBetween(today, client) : null;
  if (lens) {
    const read = readableThroughLens(lens, readThroughLens(lens, stored), readable, componentReadable);
    result = writeThroughLens(lens, body, {
      stored: withIds,
      seesStored,
      reads: mayRead && seesStored ? [read] : [],
      definitionOf: definitionOfToday(today),
      readable,
      componentFieldReadable: componentReadable,
      mayRead,
    });
    if (result.issues.length > 0) {
      return { refusedBy: 'lens', issues: result.issues, result, written: null, patched: [] };
    }
    if (result.itemIssues.length > 0) {
      return { refusedBy: 'items', issues: result.itemIssues, result, written: null, patched: [] };
    }
    input = result.input;
    pairings = result.pairings;
  }
  const { patch, issues } = validatorOf(today).fromInput(input);
  if (issues.length > 0) {
    return { refusedBy: 'fromInput', issues, result, written: null, patched: [] };
  }
  if (!lens) {
    const view = itemViewOf(componentOf, (field) => componentReadable(field.id), {
      mayRead,
      unseen: !seesStored,
    });
    const paired = pairComponentItems(patch, withIds, today.model.fields, view);
    if (paired.issues.length > 0) {
      return { refusedBy: 'items', issues: paired.issues, result, written: null, patched: [] };
    }
    pairings = paired.pairings;
  }
  const kept = keepUnreadableComponentFields(
    patch,
    withIds,
    today.model.fields,
    componentOf,
    (field) => componentReadable(field.id),
    { mayRead, input, ...(lens ? { lens } : {}), ...(pairings ? { pairings } : {}) },
  );
  return {
    refusedBy: null,
    issues: [],
    result,
    written: applyPatch(stored, kept),
    patched: Object.keys(patch),
  };
};

/**
 * A write through the lens, then today's write path as `updateDeliveryEntry` runs it: `fromInput`, the patch
 * over the stored draft, validation. null: refused (by the lens or by today's validation).
 */
const writeThrough = (
  today: Schema,
  client: Schema,
  stored: ContentData,
  input: Record<string, unknown>,
  writeMask: FieldMask = ALL,
  /** What the client could read (its role's read mask today), as `writeBaseOf` derives it. */
  readMask: FieldMask = ALL,
) => {
  const lens = lensBetween(today, client);
  const todayFields = fieldsById(today);
  const readable = (fieldId: string) => {
    const field = today.model.fields.find((candidate) => candidate.id === fieldId);
    return field !== undefined && maskAllows(readMask, field);
  };
  const publicOnly = readMask.mode === 'only' && readMask.componentFields === 'public';
  const componentReadable = (fieldId: string) => {
    const field = todayFields.get(fieldId)?.field;
    return field !== undefined && !field.deprecated && (field.public || !publicOnly);
  };
  const outcome = deliveryWrite({
    today,
    client,
    stored,
    body: input,
    mayRead: true,
    readable,
    componentReadable,
  });
  const result = outcome.result as ReturnType<typeof writeThroughLens>;
  if (outcome.refusedBy === 'lens') {
    return { lens, result, written: null, refusedBy: 'lens' as const };
  }
  if (outcome.refusedBy !== null) {
    return { lens, result, written: null, refusedBy: outcome.refusedBy, issues: outcome.issues };
  }
  const written = outcome.written as ContentData;
  // `assertWritable`: every patched field must be in the write mask (403 FORBIDDEN_FIELD otherwise).
  const denied = today.model.fields.filter(
    (field) => outcome.patched.includes(field.id) && !maskAllows(writeMask, field),
  );
  if (denied.length > 0) {
    return {
      lens,
      result,
      written: null,
      refusedBy: 'forbidden' as const,
      issues: denied.map((field) => ({ path: `/${field.apiKey}`, code: 'FORBIDDEN_FIELD', message: '403' })),
    };
  }
  const validated = validatorOf(today).validate(written, { skipRequired: true });
  return validated.issues.length > 0
    ? { lens, result, written: null, refusedBy: 'validation' as const, issues: validated.issues }
    : {
        lens,
        result,
        // Values only (the item IDs are checked by their own properties).
        written: withoutStoredItemIds(validated.data) as ContentData,
        writtenWithIds: validated.data,
        patched: outcome.patched,
        refusedBy: null,
      };
};

/** Values the write changed that it must not: fields it cannot write, fields the client does not know. */
const writeDamage = (
  lens: DefinitionLens,
  today: Schema,
  stored: ContentData,
  written: ContentData,
  /** The fields the patch named: only those were written (and paired); the rest kept their stored form. */
  patched: readonly string[],
): string[] => {
  const damage: string[] = [];
  const byId = new Map(lens.fields.map((field) => [field.fieldId, field]));
  for (const field of today.model.fields) {
    const clientField = byId.get(field.id);
    const before = stored[field.id];
    const after = written[field.id];
    const sameValue = same(withoutStoredItemIds(before), withoutStoredItemIds(after));
    if (!clientField && !sameValue) {
      damage.push(`/${field.apiKey} (added since V): ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    } else if (clientField && !isWritable(clientField) && !sameValue) {
      damage.push(
        `/${field.apiKey} (${clientField.kind}): ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
      );
    } else if (
      clientField &&
      clientField.kind !== 'null' &&
      isWritable(clientField) &&
      clientField.nested &&
      patched.includes(field.id)
    ) {
      damage.push(...instanceDamage(clientField, today, before, after, `/${field.apiKey}`));
    }
  }
  for (const key of Object.keys(stored)) {
    if (
      !today.model.fields.some((field) => field.id === key) &&
      !same(withoutStoredItemIds(stored[key]), withoutStoredItemIds(written[key]))
    ) {
      damage.push(`/${key} (no field today): stored value changed`);
    }
  }
  return damage;
};

/**
 * Inside component values written whole (property 8, plan item-ids): what the client cannot write or does not
 * know (its "hidden" part) follows the item ID. A single instance continues the stored one: its hidden part is
 * kept. In a list, a written item that keeps a stored item's `__id` holds exactly that item's hidden part; an
 * item under a new ID holds none; no stored ID is continued twice; and a stored item that is the only one with
 * its content, sent exactly once, is continued by that item (a certain pair). Both sides carry `__id`
 * (`withItemIds` on the stored side, the carry-over's on the written side).
 */
const instanceDamage = (
  field: FieldLens,
  today: Schema,
  before: unknown,
  after: unknown,
  path: string,
): string[] => {
  if (field.kind === 'null' || !field.nested) {
    return [];
  }
  const zone = field.client.type === 'dynamiczone';
  const componentIdOf = (item: unknown) =>
    zone
      ? isRecord(item)
        ? String(item[COMPONENT_KEY])
        : ''
      : (field.client.settings as { component: string }).component;
  const empty = canonicalJson({});
  /** The client-visible and hidden parts of an item (storage form), its ID, and its writable containers. */
  const split = (item: unknown) => {
    const componentId = componentIdOf(item);
    const nested = field.nested?.components.get(componentId);
    const component = componentById(today, componentId);
    const visible: Record<string, unknown> = { kind: componentId };
    const hidden: Record<string, unknown> = {};
    const containers: Array<[FieldLens, FieldDefinition]> = [];
    const record = isRecord(item) ? item : {};
    const id = typeof record.__id === 'string' ? record.__id : undefined;
    if (!nested || !component || !isRecord(item)) {
      return { visible: canonicalJson(visible), hidden: empty, containers, item: record, id };
    }
    const lensById = new Map(nested.fields.map((candidate) => [candidate.fieldId, candidate]));
    for (const componentField of component.fields) {
      const clientField = lensById.get(componentField.id);
      const value = item[componentField.id];
      if (value === undefined || value === null) {
        continue;
      }
      if (clientField && isWritable(clientField) && !componentField.deprecated) {
        visible[componentField.id] = withoutStoredItemIds(value);
        if (componentField.type === 'component' || componentField.type === 'dynamiczone') {
          containers.push([clientField, componentField]);
        }
      } else {
        hidden[componentField.id] = withoutStoredItemIds(value);
      }
    }
    return { visible: canonicalJson(visible), hidden: canonicalJson(hidden), containers, item, id };
  };
  const nestedDamage = (old: ReturnType<typeof split>, now: ReturnType<typeof split>, at: string) =>
    now.containers.flatMap(([clientField, componentField]) =>
      instanceDamage(
        clientField,
        today,
        old.item[componentField.id],
        now.item[componentField.id],
        `${at}/${componentField.apiKey}`,
      ),
    );
  if (!Array.isArray(before) || !Array.isArray(after)) {
    if (!isRecord(before) || !isRecord(after)) {
      return [];
    }
    const [old, now] = [split(before), split(after)];
    return old.hidden === now.hidden
      ? nestedDamage(old, now, path)
      : [`${path}: hidden ${old.hidden} → ${now.hidden}`];
  }
  const olds = before.map(split);
  const nows = after.map(split);
  const byId = new Map(olds.map((old) => [old.id, old]));
  const count = (items: Array<ReturnType<typeof split>>, visible: string) =>
    items.filter((item) => item.visible === visible).length;
  const continuedIds = nows.map((now) => now.id).filter((id) => byId.has(id));
  const damage: string[] =
    new Set(continuedIds).size === continuedIds.length ? [] : [`${path}: a stored item continued twice`];
  nows.forEach((now, index) => {
    const at = `${path}/${index}`;
    const continued = byId.get(now.id);
    if (!continued) {
      if (now.hidden !== empty) {
        damage.push(`${at}: a new item holds hidden ${now.hidden}`);
      }
      return;
    }
    if (continued.hidden !== now.hidden) {
      damage.push(`${at}: continues ${now.id ?? '?'}, hidden ${continued.hidden} → ${now.hidden}`);
    }
    damage.push(...nestedDamage(continued, now, at));
  });
  olds.forEach((old) => {
    if (count(olds, old.visible) === 1 && count(nows, old.visible) === 1) {
      const now = nows.find((candidate) => candidate.visible === old.visible);
      if (now && now.id !== old.id) {
        damage.push(
          `${path}: the only item like stored ${old.id ?? '?'} was sent once, yet not paired with it`,
        );
      }
    }
  });
  return damage;
};

describe('schema lens properties: writes', { timeout: 300_000 }, () => {
  it('8. write safety: a write never changes what the client cannot write or does not know; refusals are complete', async () => {
    await fc.assert(
      fc.asyncProperty(
        historyArb().chain((history) =>
          fc.tuple(
            fc.constant(history),
            fc.array(fc.constantFrom('fresh', 'sentBack', 'absent'), {
              minLength: (history.versions[0] as Schema).model.fields.length,
              maxLength: (history.versions[0] as Schema).model.fields.length,
            }),
          ),
        ),
        async ([{ versions, todayData, clientData }, sources]) => {
          const [client, today] = [versions[0] as Schema, last(versions)];
          // V-shaped values: fresh ones (V data as V's API shows it) and what the client read today.
          const fresh = await projectThrough(client, null, clientData);
          const readBack = await projectThrough(today, client, todayData);
          const input: Record<string, unknown> = {};
          // A field removed since that was private (or deprecated) at V is one the caller cannot name: the write
          // answers it as an unknown field, so a client never sends it, not even as null.
          const todayIds = new Set(today.model.fields.map((field) => field.id));
          const unnameable = (field: FieldDefinition) =>
            !todayIds.has(field.id) && (!field.public || field.deprecated);
          client.model.fields.forEach((field, index) => {
            const source = sources[index];
            const value = source === 'fresh' ? fresh[field.apiKey] : readBack[field.apiKey];
            if (source !== 'absent' && value !== undefined && !unnameable(field)) {
              input[field.apiKey] = value;
            }
          });
          const message = `${describeVersions(versions)}\n  stored ${JSON.stringify(todayData)}\n  input ${JSON.stringify(input)}`;
          const outcome = writeThrough(today, client, todayData, input);
          const issues = outcome.result.issues;
          const lensFields = new Map(outcome.lens.fields.map((field) => [field.apiKey, field]));
          const problems: string[] = [];
          for (const [apiKey, value] of Object.entries(input)) {
            const field = lensFields.get(apiKey) as FieldLens;
            const reported = issues.some(
              (issue) => issue.path === `/${apiKey}` || issue.path.startsWith(`/${apiKey}/`),
            );
            // Absent, null and [] are one thing to a write (`isMissingValue`).
            const sentBack =
              same(value, readBack[apiKey]) || (isEmptyApiValue(value) && isEmptyApiValue(readBack[apiKey]));
            // Instances sent back carry their empty fields (null, []), which the read leaves out.
            const echoed = sentBack || same(withoutEmpties(value), withoutEmpties(readBack[apiKey]));
            if (!isWritable(field) && !echoed && !reported) {
              problems.push(`/${apiKey} (${field.kind}) changed and was not refused`);
            }
            if (!isWritable(field) && echoed && issues.some((issue) => issue.path === `/${apiKey}`)) {
              problems.push(`/${apiKey} (${field.kind}) sent back as read but refused`);
            }
          }
          for (const issue of issues) {
            const apiKey = issue.path.split('/')[1] ?? '';
            if (!(apiKey in input)) {
              problems.push(`${issue.path}: refused but not sent`);
            }
          }
          if (outcome.written) {
            problems.push(
              ...writeDamage(
                outcome.lens,
                today,
                storedWithIds(today, todayData),
                outcome.writtenWithIds,
                outcome.patched ?? [],
              ),
            );
          }
          expect(problems, message).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('9. round trip: what a client reads, written straight back, is accepted and changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(historyArb(), async ({ versions, todayData }) => {
        const [client, today] = [versions[0] as Schema, last(versions)];
        // What a public delivery token reads, and writes (an app user whose role writes what it reads).
        const readMask = deliveryMask(today);
        const input = await projectThrough(today, client, todayData, readMask);
        const outcome = writeThrough(today, client, todayData, input, deliveryMask(today), readMask);
        const message = `${describeVersions(versions)}\n  stored ${JSON.stringify(todayData)}\n  read ${JSON.stringify(input)}\n  ${JSON.stringify(outcome.result.issues)} ${JSON.stringify(outcome.issues ?? [])}`;
        expect(outcome.refusedBy, message).toBeNull();
        expect(outcome.written, message).toEqual(todayData);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Effects, determinism

/**
 * Known limits in the R family (examples Z and AA, accepted 2026-11-11): stored numeric text the direct lens
 * reads exactly, and so empty, where a replay through a number reads the float's rounding: "0" for text below the
 * smallest double ("1e-400" read as an integer: Z), or the number's `String()` ("9E-7" read as a slug: AA).
 */
const knownFloatReplay = (stored: unknown, replayed: unknown): boolean => {
  if (typeof stored !== 'string' || stored.trim() === '') {
    return false;
  }
  const number = Number(stored.trim());
  if (!Number.isFinite(number)) {
    return false;
  }
  const replayedText = typeof replayed === 'number' ? String(replayed) : replayed;
  const underflow = number === 0 && /[1-9]/.test(stored.split(/e/i)[0] ?? '') && Number(replayedText) === 0;
  return underflow || replayedText === String(number);
};

describe('schema lens properties: effects and caching', { timeout: 300_000 }, () => {
  it("10. effects agree with behaviour: transparent reads V's value, nulled reads empty, converted keeps values", async () => {
    await fc.assert(
      fc.asyncProperty(
        migratedArb().chain((migrated) => {
          const history = replay(migrated.start, migrated.sequence, migrated.data);
          return fc.tuple(fc.constant(migrated), fc.constant(history), dataArb(last(history.versions)));
        }),
        async ([{ start, data }, history, todayData]) => {
          const today = last(history.versions);
          const lens = lensBetween(today, start);
          const effects = new Map(lensEffects(lens).map((entry) => [entry.fieldId, entry.effect]));
          // What a public token reads: effects are what a delivery reader sees (visibility is today's).
          const original = await projectThrough(start, null, data, deliveryMask(start));
          const migrated = await projectThrough(today, start, last(history.data), deliveryMask(today));
          const fresh = await projectThrough(today, start, todayData, deliveryMask(today));
          // `transparent` speaks of values, not of who may see them: a field private at V and public since is
          // shown through the lens (visibility is today's), so values are compared under one visibility.
          const originalAll = await projectThrough(start, null, data);
          const migratedAll = await projectThrough(today, start, last(history.data));
          const problems: string[] = [];
          for (const field of start.model.fields) {
            const effect = effects.get(field.id);
            const [was, now, freshRead] = [
              original[field.apiKey],
              migrated[field.apiKey],
              fresh[field.apiKey],
            ];
            const stored = todayData[field.id];
            if (!(field.apiKey in original)) {
              continue;
            }
            // By design (D, D2): the effect compares V's definition with today's only and cannot know what an
            // activation in between converted or dropped; the review walks the revision chain for that. Only
            // values that reached today unchanged are held to the two-endpoint effect.
            const activationChanged = !same(data[field.id], last(history.data)[field.id]);
            const [wasAll, nowAll] = [originalAll[field.apiKey], migratedAll[field.apiKey]];
            if (effect === 'transparent' && !activationChanged && !same(wasAll, shownAt(nowAll, wasAll))) {
              problems.push(
                `${field.apiKey} transparent, but ${JSON.stringify(wasAll)} reads ${JSON.stringify(nowAll)}`,
              );
            }
            if (effect === 'nulled' && (!isEmptyApiValue(now) || !isEmptyApiValue(freshRead))) {
              problems.push(
                `${field.apiKey} nulled, but reads ${JSON.stringify(now)} / ${JSON.stringify(freshRead)}`,
              );
            }
            if (
              effect === 'converted' &&
              !activationChanged &&
              !isEmptyApiValue(was) &&
              isEmptyApiValue(now)
            ) {
              problems.push(
                `${field.apiKey} converted, but V's ${JSON.stringify(was)} reads empty after migration`,
              );
            }
            if (effect === 'converted' && stored !== undefined && isEmptyApiValue(freshRead)) {
              problems.push(`${field.apiKey} converted, but today's ${JSON.stringify(stored)} reads empty`);
            }
          }
          expect(
            problems,
            `${describeVersions(history.versions)}\n  V data ${JSON.stringify(data)}\n  today ${JSON.stringify(todayData)}`,
          ).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('11. determinism: compiling the same pair twice gives structurally equal lenses', () => {
    fc.assert(
      fc.property(historyArb(), ({ versions }) => {
        const [client, today] = [versions[0] as Schema, last(versions)];
        for (const id of [MODEL_ID, ...client.components.map((component) => component.id)]) {
          expect(lensBetween(today, client, id)).toEqual(lensBetween(today, client, id));
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Counterexamples the properties found, minimized. Each `it.fails` states the property as it should hold and
// fails today; when the behaviour is fixed, vitest reports it and the `.fails` comes off.

const F = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const C1 = F(0xc1);
const C2 = F(0xc2);

type Spec = Record<string, unknown> & { id: string; apiKey: string };
const fieldOf = (spec: Spec) => ({ label: spec.apiKey, type: 'string', ...spec });
const pageOf = (fields: Spec[], extra: Record<string, unknown> = {}) =>
  normalizeDefinition({
    id: MODEL_ID,
    kind: 'collection',
    apiKey: 'page',
    pluralApiKey: 'pages',
    label: 'Page',
    localized: true,
    ...extra,
    fields: fields.map(fieldOf),
  } as Parameters<typeof normalizeDefinition>[0]);
const componentOf = (id: string, apiKey: string, fields: Spec[]) =>
  normalizeDefinition({
    id,
    kind: 'component',
    apiKey,
    label: apiKey,
    fields: fields.map(fieldOf),
  } as Parameters<typeof normalizeDefinition>[0]);
const schemaOf = (model: SchemaDefinition, components: SchemaDefinition[] = []): Schema => {
  const targets = (schemaArbTargets ??= definitionsOfTargets());
  const schema = { model, targets, components };
  expect(validateSchema(definitionsOf(schema))).toEqual([]);
  return schema;
};
let schemaArbTargets: SchemaDefinition[] | undefined;
const definitionsOfTargets = (): SchemaDefinition[] =>
  [0, 1].map((index) =>
    normalizeDefinition({
      id: index === 0 ? F(2) : F(3),
      kind: 'collection',
      apiKey: `target${index}`,
      pluralApiKey: `targets${index}`,
      label: `Target ${index}`,
      localized: true,
      fields: [{ id: F(0x50 + index), apiKey: 'name', label: 'Name', type: 'string' }],
    }),
  );
const enumSettings = (values: string[], multiple: boolean) => ({
  values: values.map((value) => ({ value, label: value })),
  multiple,
});

describe('schema lens counterexamples', () => {
  it('A. a component field deprecated at V (and today) reaches public tokens through any lens, not without one', async () => {
    // Property 4 (rename transparency) and the documented rule "deprecated hides a field from the API": the only
    // change since V is an added top-level field, yet a lensed read shows the deprecated component field `note`
    // and its stored value to a public token. Top-level deprecated fields stay hidden (delivery masks treat them
    // as non-public), so the lens is also inconsistent with itself. read.ts `componentFieldVisible` checks
    // today's `public` only, never `deprecated`.
    const hero = componentOf(C1, 'hero', [
      { id: F(0x20), apiKey: 'heading' },
      { id: F(0x21), apiKey: 'note', deprecated: true },
    ]);
    const client = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'hero', type: 'component', settings: { component: C1 } }]),
      [hero],
    );
    const today = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'hero', type: 'component', settings: { component: C1 } },
        { id: F(0x11), apiKey: 'added' },
      ]),
      [hero],
    );
    const stored = { [F(0x10)]: { [F(0x20)]: 'Hi', [F(0x21)]: 'internal note' } };
    const atV = await projectThrough(client, null, stored, deliveryMask(client));
    const lensed = await projectThrough(today, client, stored, deliveryMask(today));
    expect(atV).toEqual({ hero: { heading: 'Hi' } });
    expect(lensed).toEqual(atV); // actual: { hero: { heading: 'Hi', note: 'internal note' } }
  });

  it('A2. ... and sending that entry straight back is refused (422 UNKNOWN_FIELD on the deprecated field)', async () => {
    // Property 9 (round trip). The client read `hero.note` through the lens; echoing it, today's `fromInput`
    // refuses the deprecated field. Found with componentFields 'all' too.
    const hero = componentOf(C1, 'hero', [
      { id: F(0x20), apiKey: 'heading' },
      { id: F(0x21), apiKey: 'note', deprecated: true },
    ]);
    const client = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'hero', type: 'component', settings: { component: C1 } }]),
      [hero],
    );
    const today = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'hero', type: 'component', settings: { component: C1 } },
        { id: F(0x11), apiKey: 'added' },
      ]),
      [hero],
    );
    const stored = { [F(0x10)]: { [F(0x20)]: 'Hi', [F(0x21)]: 'internal note' } };
    const read = await projectThrough(today, client, stored, deliveryMask(today));
    const outcome = writeThrough(today, client, stored, read);
    expect(outcome.issues ?? outcome.result.issues).toEqual([]); // actual: /hero/note UNKNOWN_FIELD
    expect(outcome.written).toEqual(stored);
  });

  it('B. text made a multi-value enum reads, for the old client, the first value of each list', async () => {
    // Property 5 (monotonic loss) and the docs ("a field that became a list reads its first item"). Was: the
    // field compiled to `null` ('dropped') because `lensCanRead` had no list → text read, while a replay
    // through a single-value enum read "a". Fixed: `lensCanRead` reads through text, `fitValue` takes the
    // first item that fits.
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'tags' }]));
    const today = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'tags', type: 'enum', settings: enumSettings(['a', 'b'], true) }]),
    );
    const migrated = migrate(client, today, { [F(0x10)]: 'a' });
    expect(migrated).toEqual({ [F(0x10)]: ['a'] });
    expect(await projectThrough(today, client, migrated as ContentData)).toEqual({ tags: 'a' });
    // Any client type that reads text reads a list's first value that fits (documentation example).
    const count = schemaOf(pageOf([{ id: F(0x10), apiKey: 'count', type: 'number' }]));
    const tags = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'count', type: 'enum', settings: enumSettings(['x', '4'], true) }]),
    );
    expect(await projectThrough(tags, count, { [F(0x10)]: ['x', '4'] })).toEqual({ count: 4 });
  });

  it('C. a multi-value enum holding one value V lacks reads the values that fit', async () => {
    // Docs, "Some values read empty: enum values added since → the values that fit". Was: `fitValue` checked
    // the whole list with `checkScalar`, so one value outside V's set dropped every value (null). Fixed: list
    // clients keep the items that fit.
    const client = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'tags', type: 'enum', settings: enumSettings(['a', 'b'], true) }]),
    );
    const today = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'tags', type: 'enum', settings: enumSettings(['a', 'b', 'c'], true) }]),
    );
    expect(await projectThrough(today, client, { [F(0x10)]: ['a', 'c'] })).toEqual({ tags: ['a'] });
  });

  it("D. the two-endpoint effect of text → number is `converted`; the values the activation dropped are the review's", async () => {
    // Property 10. Text made a number drops every stored value at activation (no converter); the docs table puts
    // it under "Reads empty". `lensEffects` compares V's definition with today's only: it says what today's
    // values read as for V (every number reads back as text: `converted`) and cannot know, by design, what an
    // activation in between dropped. The change-set review covers that by walking the revision chain (case D,
    // review service). Asserted here: what the two endpoints can know.
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'price' }]));
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'price', type: 'number' }]));
    expect(migrate(client, today, { [F(0x10)]: '12' })).toEqual({});
    expect(lensEffects(lensBetween(today, client))).toEqual([{ fieldId: F(0x10), effect: 'converted' }]);
    expect(await projectThrough(today, client, { [F(0x10)]: 12 })).toEqual({ price: '12' });
  });

  it('D2. ... and `transparent` for a list an activation in between cut to its first item', () => {
    // many → one (keeps the first ID) → many: V and today agree, so the two-endpoint effect is `transparent`;
    // the entries an activation in between cut to their first relation are the review's to report (case D2,
    // revision chain), not something `lensEffects` can know.
    const many = { target: F(2), cardinality: 'many' };
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'links', type: 'relation', settings: many }]));
    const middle = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'links', type: 'relation', settings: { ...many, cardinality: 'one' } }]),
    );
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'links', type: 'relation', settings: many }]));
    const data = { [F(0x10)]: [F(0xa0), F(0xa1)] };
    const stored = migrate(middle, today, migrate(client, middle, data) as ContentData);
    expect(stored).toEqual({ [F(0x10)]: [F(0xa0)] });
    expect(lensEffects(lensBetween(today, client))[0]?.effect).toBe('transparent');
  });

  it('E. a single enum read as a list is `lossy` when today allows values V does not', async () => {
    // Property 10. Was `converted`: effects.ts `becomesList` ignored enum values. V allows [a] (multiple), today
    // [a, e] (single): "e" reads empty.
    const client = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'kind', type: 'enum', settings: enumSettings(['a'], true) }]),
    );
    const today = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'kind', type: 'enum', settings: enumSettings(['a', 'e'], false) }]),
    );
    expect(await projectThrough(today, client, { [F(0x10)]: 'e' })).toEqual({ kind: null });
    expect(lensEffects(lensBetween(today, client))[0]?.effect).toBe('lossy');
  });

  it('F. number → decimal is lossless, exponent-notation numbers included', async () => {
    // Property 10. Was: `String(1e-7)` gave "1e-7", which DECIMAL_PATTERN refuses (1e21, -5e-324 likewise), so
    // those read null. Fixed: `plainNumber` writes the exact digits.
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'amount', type: 'decimal' }]));
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'amount', type: 'number' }]));
    expect(lensEffects(lensBetween(today, client))[0]?.effect).toBe('converted');
    expect(await projectThrough(today, client, { [F(0x10)]: 1e-7 })).toEqual({ amount: '0.0000001' });
    expect(await projectThrough(today, client, { [F(0x10)]: 1e21 })).toEqual({
      amount: '1000000000000000000000',
    });
    expect(await projectThrough(today, client, { [F(0x10)]: -5e-324 })).toEqual({
      amount: `-0.${'0'.repeat(323)}5`,
    });
  });

  it('G. a zone whose component lost one inner field is `lossy`, not `nulled`: it still reads its items', async () => {
    // Property 10, wording. Was `nulled` ("Reads empty" in the review) for the whole zone. Fixed: a container
    // is `nulled` only when no instance of it can be read.
    const block = (fields: Spec[]) => componentOf(C1, 'block', fields);
    const zone = { id: F(0x10), apiKey: 'blocks', type: 'dynamiczone', settings: { components: [C1] } };
    const client = schemaOf(pageOf([zone]), [
      block([
        { id: F(0x20), apiKey: 'a' },
        { id: F(0x21), apiKey: 'b' },
      ]),
    ]);
    const today = schemaOf(pageOf([zone]), [block([{ id: F(0x20), apiKey: 'a' }])]);
    const read = await projectThrough(today, client, {
      [F(0x10)]: [{ [COMPONENT_KEY]: C1, [F(0x20)]: 'x' }],
    });
    expect(read).toEqual({ blocks: [{ __component: 'block', a: 'x', b: null }] });
    expect(lensEffects(lensBetween(today, client))[0]?.effect).toBe('lossy');
  });

  it('H. a relation retargeted since V: sending back the empty value the client read is refused', async () => {
    // Property 8/9. The projection hides a retargeted relation's IDs (`targetMoved`), but the write compares with
    // `readThroughLens`, which keeps them, so the echoed [] does not match and the write is 422.
    const client = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'links', type: 'relation', settings: { target: F(2), cardinality: 'many' } },
      ]),
    );
    const today = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'links', type: 'relation', settings: { target: F(3), cardinality: 'many' } },
      ]),
    );
    const stored = { [F(0x10)]: [F(0xa0)] };
    const read = await projectThrough(today, client, stored);
    expect(read).toEqual({ links: [] });
    expect(writeThrough(today, client, stored, read).result.issues).toEqual([]); // actual: /links NOT_ALLOWED
  });

  it('H2. ... while sending the hidden stored IDs is accepted: a write confirms a guess of a hidden value', async () => {
    // The refusal is meant never to tell a caller whether it guessed a hidden value (write.ts
    // `readableThroughLens`); for a retargeted relation the IDs are hidden from the read but not from the check.
    const client = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'links', type: 'relation', settings: { target: F(2), cardinality: 'many' } },
      ]),
    );
    const today = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'links', type: 'relation', settings: { target: F(3), cardinality: 'many' } },
      ]),
    );
    const stored = { [F(0x10)]: [F(0xa0)] };
    const guessed = writeThrough(today, client, stored, { links: [F(0xa0)] }).result.issues;
    const wrong = writeThrough(today, client, stored, { links: [F(0xa1)] }).result.issues;
    expect(guessed.length).toBe(wrong.length); // actual: 0 vs 1
  });

  it('I. a public token echoing an entry keeps the private component fields it cannot see', async () => {
    // Property 9 with a public token's mask. Was: a component is written whole and the private field the token
    // cannot see was not in the instance it sent, so it was wiped (lens or not). Fixed by the REST work
    // (`keepUnreadableComponentFields` carries unreadable component fields over from the stored draft).
    const hero = componentOf(C1, 'hero', [
      { id: F(0x20), apiKey: 'heading' },
      { id: F(0x21), apiKey: 'note', public: false },
    ]);
    const client = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'hero', type: 'component', settings: { component: C1 } }]),
      [hero],
    );
    const today = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'hero', type: 'component', settings: { component: C1 } },
        { id: F(0x11), apiKey: 'added' },
      ]),
      [hero],
    );
    const stored = { [F(0x10)]: { [F(0x20)]: 'Hi', [F(0x21)]: 'private' } };
    const read = await projectThrough(today, client, stored, deliveryMask(today));
    expect(writeThrough(today, client, stored, read, ALL, deliveryMask(today)).written).toEqual(stored);
  });

  it('J. probe: an old revision (snapshot) with items of a component the zone no longer allows, made private since', async () => {
    // Hypothesis from reading read.ts: `componentFieldVisible` looks today's field up among the components
    // today's model embeds; a component the zone dropped is not among them, so the client's `public` flag would
    // decide. Holds today: the field stays hidden (kept as a regression check).
    const block = (isPublic: boolean) =>
      componentOf(C1, 'block', [{ id: F(0x20), apiKey: 'secret', public: isPublic }]);
    const other = componentOf(C2, 'other', [{ id: F(0x30), apiKey: 'x' }]);
    const client = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'blocks', type: 'dynamiczone', settings: { components: [C1, C2] } }]),
      [block(true), other],
    );
    const today = schemaOf(
      pageOf([{ id: F(0x10), apiKey: 'blocks', type: 'dynamiczone', settings: { components: [C2] } }]),
      [block(false), other],
    );
    const oldRevision = { [F(0x10)]: [{ [COMPONENT_KEY]: C1, [F(0x20)]: 'leaked?' }] };
    const read = await projectThrough(today, client, oldRevision, deliveryMask(today));
    expect(JSON.stringify(read)).not.toContain('leaked?');
  });

  it('K. a field made private since V reads null for a wildcard token, and echoing the entry is accepted unchanged', async () => {
    // Property 9. Was: echoing the null a hidden field reads as was a write to a field the role may not write
    // (403 FORBIDDEN_FIELD), or cleared it with a write grant naming it. Fixed by the REST work: the empty
    // value a hidden field reads as, sent back, keeps the stored value.
    const client = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'title' },
        { id: F(0x11), apiKey: 'secret' },
      ]),
    );
    const today = schemaOf(
      pageOf([
        { id: F(0x10), apiKey: 'title' },
        { id: F(0x11), apiKey: 'secret', public: false },
      ]),
    );
    const stored = { [F(0x10)]: 'Hello', [F(0x11)]: 'private' };
    const read = await projectThrough(today, client, stored, deliveryMask(today));
    expect(read).toEqual({ title: 'Hello', secret: null });
    const outcome = writeThrough(today, client, stored, read, deliveryMask(today), deliveryMask(today));
    expect(outcome.issues ?? []).toEqual([]);
    expect(outcome.written).toEqual(stored);
  });

  it('L. a relation the client cannot write: removing an item it read is refused or written, never silently ignored', () => {
    // Regression check (was a counterexample; fixed in write.ts). Property 8, found after the REST hardening
    // (write.ts `matchesRead` → `isSubsequence`): to allow for
    // targets a delivery read hides, any subsequence of the read counts as "sent back", so the stored value is
    // kept. Here the field became shared across locales (not writable through the lens); the client drops one
    // relation and gets a success while nothing changes.
    const links = (localized: boolean): Spec => ({
      id: F(0x10),
      apiKey: 'links',
      type: 'relation',
      localized,
      settings: { target: F(2), cardinality: 'many' },
    });
    const client = schemaOf(pageOf([links(true)]));
    const today = schemaOf(pageOf([links(false)]));
    const stored = { [F(0x10)]: [F(0xa0), F(0xa1)] };
    const outcome = writeThrough(today, client, stored, { links: [F(0xa0)] });
    // Either refused (the field cannot be written through this version) or written: not silently kept.
    expect(outcome.result.issues.length > 0 || canonicalJson(outcome.written) !== canonicalJson(stored)).toBe(
      true,
    );
  });

  it('M. echoing an entry is accepted when a hidden component holds a deprecated field', async () => {
    // Regression check (was a counterexample; fixed in write.ts). Property 9, found after the REST hardening:
    // `inner` (a component field, private) is hidden from a public token, so the lens write carries its stored instance over whole (`keep` → `toInput`), deprecated field
    // `x` inside it included; today's `fromInput` refuses deprecated fields (422 UNKNOWN_FIELD at
    // /blocks/0/inner/x). `keep` skips deprecated fields at its own level, not inside the instance it carries.
    const leaf = componentOf(C2, 'leaf', [{ id: F(0x30), apiKey: 'x', deprecated: true }]);
    const block = componentOf(C1, 'block', [
      { id: F(0x20), apiKey: 'inner', type: 'component', public: false, settings: { component: C2 } },
    ]);
    const zone: Spec = { id: F(0x10), apiKey: 'blocks', type: 'dynamiczone', settings: { components: [C1] } };
    const client = schemaOf(pageOf([zone]), [block, leaf]);
    const today = schemaOf(pageOf([zone, { id: F(0x11), apiKey: 'added' }]), [block, leaf]);
    const stored = { [F(0x10)]: [{ [COMPONENT_KEY]: C1, [F(0x20)]: { [F(0x30)]: 'kept' } }] };
    const read = await projectThrough(today, client, stored, deliveryMask(today));
    const outcome = writeThrough(today, client, stored, read, deliveryMask(today), deliveryMask(today));
    expect(outcome.issues ?? []).toEqual([]);
    expect(outcome.written).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Item matching in component lists (`keepUnreadableComponentFields`, delivery-api.md "Writing components")

const LIST_X = F(0xc1);
const LIST_Y = F(0xc2);
const LIST_FIELDS = { v: F(0x20), h: F(0x21), d: F(0x22), u: F(0x23), yv: F(0x30), yh: F(0x31) };
const ITEMS = F(0x10);
const BLOCKS = F(0x11);

/** Today: X holds a visible `v`, a private `h`, a deprecated `d` and `u` (added since V when through a lens). */
const listSchemas = () => {
  const x = (withU: boolean) =>
    componentOf(LIST_X, 'x', [
      { id: LIST_FIELDS.v, apiKey: 'v' },
      { id: LIST_FIELDS.h, apiKey: 'h', public: false },
      { id: LIST_FIELDS.d, apiKey: 'd', deprecated: true },
      ...(withU ? [{ id: LIST_FIELDS.u, apiKey: 'u' }] : []),
    ]);
  const y = componentOf(LIST_Y, 'y', [
    { id: LIST_FIELDS.yv, apiKey: 'v' },
    { id: LIST_FIELDS.yh, apiKey: 'h', public: false },
  ]);
  const model = pageOf([
    { id: ITEMS, apiKey: 'items', type: 'component', settings: { component: LIST_X, repeatable: true } },
    { id: BLOCKS, apiKey: 'blocks', type: 'dynamiczone', settings: { components: [LIST_X, LIST_Y] } },
  ]);
  return { today: schemaOf(model, [x(true), y]), atV: schemaOf(model, [x(false), y]) };
};

type ListMode = 'public' | 'lens' | 'noRead' | 'noReadLens';
const LIST_MODES: readonly ListMode[] = ['public', 'lens', 'noRead', 'noReadLens'];

type StoredItem = { kind: 'x' | 'y'; v: string; h: boolean; d: boolean; u: boolean };
type SentItem = {
  kind: 'x' | 'y';
  v: string;
  origin: { type: 'kept' | 'edited'; from: number } | { type: 'new' };
};

/** The fields a caller of `mode` sees (and so sends, and is matched by) in an item of `kind`. */
const seenFields = (mode: ListMode, kind: 'x' | 'y'): Array<'v' | 'h' | 'u'> => {
  const read = mode === 'public' || mode === 'lens';
  const lens = mode === 'lens' || mode === 'noReadLens';
  if (kind === 'y') {
    return read ? ['v'] : ['v', 'h'];
  }
  return [...(['v'] as const), ...(read ? [] : (['h'] as const)), ...(lens ? [] : (['u'] as const))];
};
/** The hidden fields of an item of `kind` for a caller of `mode`: what must travel with the item. */
const hiddenFields = (mode: ListMode, kind: 'x' | 'y'): Array<'h' | 'd' | 'u'> =>
  (kind === 'x' ? (['h', 'd', 'u'] as const) : (['h'] as const)).filter(
    (name) => !(seenFields(mode, kind) as string[]).includes(name),
  );

const fieldIdOfList = (kind: 'x' | 'y', name: 'v' | 'h' | 'd' | 'u') =>
  kind === 'y' ? (name === 'v' ? LIST_FIELDS.yv : LIST_FIELDS.yh) : LIST_FIELDS[name];

/** A stored item in storage form; hidden values name the item they belong to (`h3` is item 3's). */
const storedItem = (item: StoredItem, index: number, zone: boolean): Record<string, unknown> => ({
  ...(zone ? { [COMPONENT_KEY]: item.kind === 'x' ? LIST_X : LIST_Y } : {}),
  [fieldIdOfList(item.kind, 'v')]: item.v,
  ...(item.h ? { [fieldIdOfList(item.kind, 'h')]: `h${index}` } : {}),
  ...(item.kind === 'x' && item.d ? { [LIST_FIELDS.d]: `d${index}` } : {}),
  ...(item.kind === 'x' && item.u ? { [LIST_FIELDS.u]: `u${index}` } : {}),
});

const storedListArb = (zone: boolean) =>
  fc.array(
    fc.record({
      kind: zone ? fc.constantFrom<'x' | 'y'>('x', 'y') : fc.constant<'x' | 'y'>('x'),
      v: fc.constantFrom('p', 'q', 'r'),
      h: fc.boolean(),
      d: fc.boolean(),
      u: fc.boolean(),
    }),
    { maxLength: 5 },
  );

/** Deletions, reorders and in-place or moved edits of stored items, plus inserted ones. */
const sentListArb = (stored: StoredItem[], zone: boolean): fc.Arbitrary<SentItem[]> =>
  fc
    .tuple(
      fc.shuffledSubarray(
        stored.map((_, index) => index),
        { minLength: 0, maxLength: stored.length },
      ),
      fc.array(fc.option(fc.constantFrom('p', 'q', 'r', 's'), { nil: undefined, freq: 2 }), {
        minLength: stored.length,
        maxLength: stored.length,
      }),
      fc.array(
        fc.record({
          kind: zone ? fc.constantFrom<'x' | 'y'>('x', 'y') : fc.constant<'x' | 'y'>('x'),
          v: fc.constantFrom('p', 'q', 'r', 's'),
          at: fc.nat({ max: 6 }),
        }),
        { maxLength: 2 },
      ),
    )
    .map(([kept, edits, inserts]) => {
      const sent: SentItem[] = kept.map((from) => {
        const item = stored[from] as StoredItem;
        const edit = edits[from];
        return edit === undefined || edit === item.v
          ? { kind: item.kind, v: item.v, origin: { type: 'kept', from } }
          : { kind: item.kind, v: edit, origin: { type: 'edited', from } };
      });
      for (const insert of inserts) {
        sent.splice(Math.min(insert.at, sent.length), 0, {
          kind: insert.kind,
          v: insert.v,
          origin: { type: 'new' },
        });
      }
      return sent;
    });

/** The body a caller of `mode` sends for one item (API IDs): what it sees, as stored for an untouched item. */
const sentBody = (
  mode: ListMode,
  item: SentItem,
  stored: StoredItem[],
  zone: boolean,
): Record<string, unknown> => {
  const from = item.origin.type === 'new' ? undefined : item.origin.from;
  const original = from === undefined ? undefined : storedItem(stored[from] as StoredItem, from, zone);
  const body: Record<string, unknown> = zone ? { [COMPONENT_KEY]: item.kind } : {};
  for (const name of seenFields(mode, item.kind)) {
    if (name === 'v') {
      body.v = item.v;
    } else if (original && original[fieldIdOfList(item.kind, name)] !== undefined) {
      body[name] = original[fieldIdOfList(item.kind, name)];
    }
  }
  return body;
};

/** The written lists through the real write path of `mode` (lens translation, input, carried fields). */
/**
 * A list write of `mode` through the real write path: `{ written, issues }`, `written` null when refused (an
 * item issue: `AMBIGUOUS_ITEMS`, an unknown or duplicate ID). `written` keeps every instance's `__id`.
 */
const writeListsOutcome = (mode: ListMode, stored: ContentData, body: Record<string, unknown>) => {
  const { today, atV } = listSchemas();
  const withLens = mode === 'lens' || mode === 'noReadLens';
  const mayRead = mode === 'public' || mode === 'lens';
  const all = fieldsById(today);
  const componentReadable = (fieldId: string) => {
    const field = all.get(fieldId)?.field;
    return mayRead && field !== undefined && field.public && !field.deprecated;
  };
  const outcome = deliveryWrite({
    today,
    client: withLens ? atV : null,
    stored,
    body,
    mayRead,
    readable: () => mayRead,
    componentReadable,
  });
  expect(
    outcome.refusedBy === 'lens' || outcome.refusedBy === 'fromInput',
    JSON.stringify(outcome.issues),
  ).toBe(false);
  return outcome;
};

/** `writeListsOutcome`'s written data, values only; refused writes fail the calling test. */
const writeLists = (mode: ListMode, stored: ContentData, body: Record<string, unknown>) => {
  const outcome = writeListsOutcome(mode, stored, body);
  expect(outcome.issues, 'refused').toEqual([]);
  return withoutStoredItemIds(outcome.written) as ContentData;
};

/** Problems with where hidden values ended up, for one list. */
const provenanceProblems = (
  mode: ListMode,
  stored: StoredItem[],
  sent: SentItem[],
  written: unknown,
  zone: boolean,
): { real: string[]; inPlace: string[] } => {
  const real: string[] = [];
  const inPlace: string[] = [];
  const items = Array.isArray(written) ? written : [];
  if (items.length !== sent.length) {
    return { real: [`wrote ${items.length} items for ${sent.length} sent`], inPlace };
  }
  const keyOf = (kind: string, values: Record<string, unknown>) =>
    canonicalJson({ kind: zone ? kind : 'x', values });
  const storedKey = (index: number) => {
    const item = stored[index] as StoredItem;
    const data = storedItem(item, index, zone);
    return keyOf(
      item.kind,
      Object.fromEntries(
        seenFields(mode, item.kind).map((name) => [name, data[fieldIdOfList(item.kind, name)] ?? null]),
      ),
    );
  };
  const sentKey = (item: SentItem) => {
    const body = sentBody(mode, item, stored, zone);
    return keyOf(
      item.kind,
      Object.fromEntries(seenFields(mode, item.kind).map((name) => [name, body[name] ?? null])),
    );
  };
  const bundle = (index: number) => {
    const item = stored[index] as StoredItem;
    const data = storedItem(item, index, zone);
    return canonicalJson(
      Object.fromEntries(
        hiddenFields(mode, item.kind).flatMap((name) => {
          const value = data[fieldIdOfList(item.kind, name)];
          return value === undefined ? [] : [[name, value]];
        }),
      ),
    );
  };
  const empty = canonicalJson({});
  items.forEach((written, position) => {
    const item = sent[position] as SentItem;
    const values = isRecord(written) ? written : {};
    const carried = Object.fromEntries(
      hiddenFields(mode, item.kind).flatMap((name) => {
        const value = values[fieldIdOfList(item.kind, name)];
        return value === undefined ? [] : [[name, value]];
      }),
    );
    const sources = new Set(
      Object.values(carried).map((value) =>
        typeof value === 'string' ? Number(value.slice(1)) : Number.NaN,
      ),
    );
    const at = `#${position} (${item.origin.type}${item.origin.type === 'new' ? '' : ` from ${item.origin.from}`})`;
    if (sources.size > 1) {
      real.push(`${at}: hidden values of several stored items ${JSON.stringify(carried)}`);
      return;
    }
    const [source] = [...sources];
    const sameAsSeen = (index: number) => storedKey(index) === sentKey(item);
    if (source !== undefined) {
      if (canonicalJson(carried) !== bundle(source)) {
        real.push(`${at}: part of item ${source}'s hidden values ${JSON.stringify(carried)}`);
      } else if (!sameAsSeen(source) && !(item.origin.type === 'edited' && item.origin.from === source)) {
        // An item edited where it was keeps its own values; any other item that is not this one to the caller
        // may carry them only by the documented substitution (P, as the alignment reads it, plan item-ids): a
        // stored item that nothing was sent back as, unchanged and once, read as edited where it stood.
        // The alignment's reading decides which stored items were "deleted or edited where they stood": an
        // item moved across a unique anchor counts as deleted plus new, so a new item in its old place may take
        // its values (case W). Any same-kind substitution is that documented trade-off (12b keeps it visible);
        // what is checked strictly is above (one source, whole) and below (a certain pair keeps its own).
        const documentedInPlace = (stored[source] as StoredItem).kind === item.kind;
        (documentedInPlace ? inPlace : real).push(
          `${at}: carries item ${source}'s hidden values ${JSON.stringify(carried)} though it is not that item`,
        );
      }
    }
    // (a) an item sent back untouched keeps exactly its own hidden values, when it is unambiguous to the caller.
    if (item.origin.type === 'kept') {
      const from = item.origin.from;
      const key = sentKey(item);
      const unambiguous =
        stored.filter((_, index) => storedKey(index) === key).length === 1 &&
        sent.filter((candidate) => sentKey(candidate) === key).length === 1;
      if (
        unambiguous &&
        canonicalJson(carried) !== bundle(from) &&
        !(bundle(from) === empty && source === undefined)
      ) {
        real.push(
          `${at}: untouched, but carries ${JSON.stringify(carried)} instead of its own ${bundle(from)}`,
        );
      }
    }
  });
  // No stored item's values are carried by two written items.
  const carriers = items.flatMap((written) => {
    const values = isRecord(written) ? written : {};
    return Object.values(values).flatMap((value) =>
      typeof value === 'string' && /^[hdu]\d+$/.test(value) ? [value] : [],
    );
  });
  if (new Set(carriers).size !== carriers.length) {
    real.push(`a stored value is carried twice: ${carriers.join(',')}`);
  }
  return { real, inPlace };
};

describe('item matching in component lists', { timeout: 300_000 }, () => {
  const caseArb = fc
    .tuple(storedListArb(false), storedListArb(true), fc.constantFrom(...LIST_MODES))
    .chain(([items, blocks, mode]) =>
      fc.record({
        mode: fc.constant(mode),
        items: fc.constant(items),
        blocks: fc.constant(blocks),
        sentItems: sentListArb(items, false),
        sentBlocks: sentListArb(blocks, true),
      }),
    );
  const run = ({
    mode,
    items,
    blocks,
    sentItems,
    sentBlocks,
  }: {
    mode: ListMode;
    items: StoredItem[];
    blocks: StoredItem[];
    sentItems: SentItem[];
    sentBlocks: SentItem[];
  }) => {
    const stored: ContentData = {
      ...(items.length > 0 ? { [ITEMS]: items.map((item, index) => storedItem(item, index, false)) } : {}),
      ...(blocks.length > 0 ? { [BLOCKS]: blocks.map((item, index) => storedItem(item, index, true)) } : {}),
    };
    const body = {
      items: sentItems.map((item) => sentBody(mode, item, items, false)),
      blocks: sentBlocks.map((item) => sentBody(mode, item, blocks, true)),
    };
    const outcome = writeListsOutcome(mode, stored, body);
    // Refused (an item issue: ambiguous, or a caller that cannot see the items it replaces): nothing written.
    const written = (withoutStoredItemIds(outcome.written) ?? {}) as ContentData;
    const a = outcome.written
      ? provenanceProblems(mode, items, sentItems, written[ITEMS], false)
      : { real: [], inPlace: [] };
    const b = outcome.written
      ? provenanceProblems(mode, blocks, sentBlocks, written[BLOCKS], true)
      : { real: [], inPlace: [] };
    return {
      refused: outcome.written === null,
      real: [...a.real.map((line) => `items ${line}`), ...b.real.map((line) => `blocks ${line}`)],
      inPlace: [...a.inPlace, ...b.inPlace],
      message: `mode ${mode}\n  stored ${JSON.stringify(stored)}\n  sent ${JSON.stringify({ sentItems, sentBlocks })}\n  written ${JSON.stringify(written)}`,
    };
  };

  it('12. without IDs: refused, or hidden and unknown values stay with their item (untouched items keep them, none moves)', () => {
    fc.assert(
      fc.property(caseArb, (input) => {
        const { real, message } = run(input);
        expect(real, message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('12c. two items of 100,000+ characters, swapped, keep their own hidden values (callers that read; refused for the others)', () => {
    // Items are paired by a SHA-256 of what the caller sees; no per-item size cap. The two differ in one
    // character somewhere in a long run.
    fc.assert(
      fc.property(
        fc.constantFrom(...LIST_MODES),
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom('a', 'b', '7'),
        (mode, at, letter) => {
          const base = 'x'.repeat(100_001);
          const first = `${base.slice(0, at)}${letter}${base.slice(at + 1)}`;
          const stored: StoredItem[] = [
            { kind: 'x', v: first, h: true, d: true, u: true },
            { kind: 'x', v: base, h: true, d: true, u: true },
          ];
          const sent: SentItem[] = [
            { kind: 'x', v: base, origin: { type: 'kept', from: 1 } },
            { kind: 'x', v: first, origin: { type: 'kept', from: 0 } },
          ];
          const outcome = writeListsOutcome(
            mode,
            { [ITEMS]: stored.map((item, index) => storedItem(item, index, false)) },
            { items: sent.map((item) => sentBody(mode, item, stored, false)), blocks: [] },
          );
          if (mode === 'noRead' || mode === 'noReadLens') {
            // A caller that cannot see the items it replaces, without IDs: refused (plan item-ids, decision 1).
            expect(
              outcome.issues.map((issue) => issue.code),
              mode,
            ).toEqual(['AMBIGUOUS_ITEMS']);
            return;
          }
          const items = (withoutStoredItemIds(outcome.written) as ContentData)[ITEMS] as Array<
            Record<string, unknown>
          >;
          const { real } = provenanceProblems(mode, stored, sent, items, false);
          expect(real, mode).toEqual([]);
          for (const name of hiddenFields(mode, 'x')) {
            expect(items[0]?.[fieldIdOfList('x', name)], `${mode} ${name}`).toBe(`${name}1`);
            expect(items[1]?.[fieldIdOfList('x', name)], `${mode} ${name}`).toBe(`${name}0`);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it.fails(
    '12b. without IDs, a new or edited-and-moved item carries nothing (as stated; the documented substitution breaks it)',
    () => {
      // Recorded by decision (plan item-ids, 9 and "after implementation"): without IDs, a moved-and-edited item
      // is "deleted plus a new item" and carries nothing, and cases with more than one least-edit alignment
      // are refused; but an item read as edited where a stored item stood (the substitution, P) carries that
      // item's values. Sending `id` makes every case certain (ID1).
      fc.assert(
        fc.property(caseArb, (input) => {
          const { inPlace, message } = run(input);
          expect(inPlace, message).toEqual([]);
        }),
        { numRuns: RUNS },
      );
    },
  );
});

describe('schema lens counterexamples, property 5', () => {
  it('N. a zone item an intermediate version did not allow: the direct lens keeps it, a replay drops it', () => {
    // Found once at LENS_PROPERTY_RUNS=5000 elsewhere, reproduced with LENS_PROPERTY_SEED=202 at 50,000 runs
    // (run 22,873). Not a lens bug: V allows [b, c], an intermediate version only [b], today [b, c]; an item of
    // c written today reads through the direct lens (both ends allow c) and is dropped by the replay. The
    // property's oracle compared lists of objects position by position; it now matches the replay's items as a
    // subsequence of the direct read's.
    const b = componentOf(C1, 'b', [{ id: F(0x20), apiKey: 'x' }]);
    const c = componentOf(C2, 'c', [{ id: F(0x30), apiKey: 'y' }]);
    const zone = (components: string[]): Spec => ({
      id: F(0x10),
      apiKey: 'blocks',
      type: 'dynamiczone',
      settings: { components },
    });
    const client = schemaOf(pageOf([zone([C1, C2])]), [b, c]);
    const middle = schemaOf(pageOf([zone([C1])]), [b, c]);
    const today = schemaOf(pageOf([zone([C1, C2])]), [b, c]);
    const stored = {
      [F(0x10)]: [
        { [COMPONENT_KEY]: C2, [F(0x30)]: 'c' },
        { [COMPONENT_KEY]: C1, [F(0x20)]: 'b' },
      ],
    };
    const direct = readThroughLens(lensBetween(today, client), stored);
    const replayed = readThroughLens(
      lensBetween(middle, client),
      readThroughLens(lensBetween(today, middle), stored),
    );
    expect(direct[F(0x10)]).toHaveLength(2);
    expect(replayed[F(0x10)]).toEqual([{ [COMPONENT_KEY]: C1, [F(0x20)]: 'b' }]);
  });

  it('O. through a lens, a caller that may update but not read cannot clear a field: its null is ignored', () => {
    // Property 12 (item matching), minimized: a write-only caller (no read access) sends `title: null` or
    // `items: []` through a lens; write.ts treats an empty value for a field the caller cannot read as "the
    // empty value it read, sent back" and keeps the stored value. The write succeeds and nothing is cleared.
    // Without a lens the same write clears the field.
    const fields = (extra: Spec[]): Spec[] => [{ id: F(0x10), apiKey: 'title' }, ...extra];
    const client = schemaOf(pageOf(fields([])));
    const today = schemaOf(pageOf(fields([{ id: F(0x11), apiKey: 'added' }])));
    const lens = lensBetween(today, client);
    const stored = { [F(0x10)]: 'keep me?' };
    const result = writeThroughLens(
      lens,
      { title: null },
      {
        stored,
        reads: [],
        definitionOf: definitionOfToday(today),
        readable: () => false,
        componentFieldReadable: () => false,
      },
    );
    expect(result.issues).toEqual([]);
    const { patch } = validatorOf(today).fromInput(result.input);
    expect(applyPatch(stored, patch)).toEqual({});
  });

  it.fails(
    "P. delete an item and insert a new one in its place: the new item inherits the deleted one's hidden values",
    () => {
      // Property 12b (as stated: a new or edited-and-moved item carries nothing), minimized. By the documented rule
      // (delivery-api.md "Writing components", 2: in place when the list keeps its length), a new item sent where
      // a deleted item stood is taken for an edit of it and keeps its private value `h`. The server cannot tell the
      // two apart from a body without IDs; recorded so the trade-off stays visible. Decision (plan item-ids, 9):
      // documented without IDs; with IDs certain (`id: null` marks the new item: "P with IDs").
      const items = { [ITEMS]: [{ [LIST_FIELDS.v]: 'p', [LIST_FIELDS.h]: 'h0' }] };
      const written = writeLists('public', items, { items: [{ v: 'new item' }], blocks: [] });
      expect(written[ITEMS]).toEqual([{ [LIST_FIELDS.v]: 'new item' }]); // actual: h: 'h0' carried over
    },
  );

  it('Q. numeric text that is not canonical ("00012", " 12 ") reads as a big integer, exactly, as a replay does', () => {
    // Property 5 (the direct lens never returns less than a replay), found with LENS_PROPERTY_SEED=1809 at
    // 50,000 runs (run 49,638; there through rich text "00012"). V: biginteger; an intermediate version: integer;
    // today: string. The replay reads "00012" as the integer 12 (`convertType` text → number), then 12 as "12".
    // The direct lens tries text → biginteger only: "00012" fails the canonical big-integer pattern, so null.
    // Decimal clients likewise ("012.5"). Fixed: decimal and big-integer clients read numeric text with its
    // exact digits (values.ts `exactNumberText`), never through a float.
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'biginteger' }]));
    const middle = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'integer' }]));
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n' }]));
    const stored = { [F(0x10)]: '00012' };
    const replayed = readThroughLens(
      lensBetween(middle, client),
      readThroughLens(lensBetween(today, middle), stored),
    );
    expect(replayed).toEqual({ [F(0x10)]: '12' });
    expect(readThroughLens(lensBetween(today, client), stored)).toEqual({ [F(0x10)]: '12' });
    const read = (type: string, value: string) =>
      readThroughLens(lensBetween(today, schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type }]))), {
        [F(0x10)]: value,
      })[F(0x10)];
    expect(read('biginteger', ' 12 ')).toBe('12');
    expect(read('biginteger', '99999999999999999999')).toBe('99999999999999999999');
    expect(read('biginteger', '-00012.000')).toBe('-12');
    expect(read('biginteger', '12.5')).toBeUndefined();
    expect(read('biginteger', 'twelve')).toBeUndefined();
    expect(read('decimal', '012.5')).toBe('12.5');
    expect(read('decimal', '.5')).toBe('0.5');
    expect(read('decimal', '1.5e-3')).toBe('0.0015');
    expect(read('decimal', '1e3')).toBe('1000');
    // Canonical already (the decimal validator accepts "-0"): read as written.
    expect(read('decimal', '-0')).toBe('-0');
    // Trimmed comes before the number spelling, and "-0" fits a decimal as written.
    expect(read('decimal', ' -0 ')).toBe('-0');
  });

  it.fails('R. a number read as text: "5e-324" directly, "0.000…5" through a decimal version', () => {
    // Property 5, found with LENS_PROPERTY_SEED=2415 at 50,000 runs (run 46,677). V: string; an intermediate
    // version: decimal; today: number. Directly, number → text is `String()` ("5e-324", as the activation's own
    // conversion writes it); the replay goes number → decimal (exact digits) → text. Same value, other text.
    // Cosmetic. Decision (2026-11-10): stays; the direct lens matches what activation's own conversion writes.
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n' }]));
    const middle = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'decimal' }]));
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'number' }]));
    const stored = { [F(0x10)]: 5e-324 };
    const replayed = readThroughLens(
      lensBetween(middle, client),
      readThroughLens(lensBetween(today, middle), stored),
    );
    expect(readThroughLens(lensBetween(today, client), stored)).toEqual(replayed);
  });

  it.fails(
    'Z. text below the smallest double, read as a big integer through a number version: "0" by replay, empty directly',
    () => {
      // Property 5, found with LENS_PROPERTY_SEED=303 at 50,000 runs (run 14,480). V: biginteger; an intermediate
      // version: number; today: string, holding "1e-400000000". The replay parses the text as a number, which
      // underflows to 0, and 0 is an integer: it reads "0". The direct lens reads the exact text, which is not an
      // integer, so it reads empty. Same for "1e-400", "-1e-400", "5e-325" and a 400-digit "0.000…1"; "1e-5" reads
      // empty both ways. The direct read is the exact one; the replay's "0" is the float conversion's rounding.
      // Also LENS_PROPERTY_SEED=1010 (run 17,028): "9E-401" through integer and biginteger versions to a decimal V.
      // Decision (2026-11-11): accepted as a known limit in the R family (the direct read is exact); property 5
      // allows it (knownFloatReplay).
      const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'biginteger' }]));
      const middle = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'number' }]));
      const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'string' }]));
      const stored = { [F(0x10)]: '1e-400' };
      const replayed = readThroughLens(
        lensBetween(middle, client),
        readThroughLens(lensBetween(today, middle), stored),
      );
      expect(replayed).toEqual({ [F(0x10)]: '0' });
      expect(readThroughLens(lensBetween(today, client), stored)).toEqual(replayed);
    },
  );

  it.fails(
    'AA. "9E-7" or "0.0000009" read as a slug through a number version: "9e-7" by replay, empty directly',
    () => {
      // Property 5, found with LENS_PROPERTY_SEED=1919 at 50,000 runs (run 46,686). V: slug; an intermediate
      // version: number; today: string, holding "9E-7". The replay parses it as a number and writes it back as
      // `String()` ("9e-7", a valid slug). The direct lens tries the text as written (uppercase E: not a slug),
      // then trimmed, then as its exact digits ("0.0000009": the dot is not a slug), so it reads empty. "1E5" reads
      // "100000" both ways; "9e-07" reads "9e-07" directly and "9e-7" by replay (spelling, as R). The residue of S:
      // the direct lens never tries `String()` of the number. Decision (2026-11-11): accepted as a known limit in the R family; property 5
      // allows it (knownFloatReplay).
      const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'slug' }]));
      const middle = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'number' }]));
      const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'string' }]));
      for (const text of ['9E-7', '0.0000009']) {
        const stored = { [F(0x10)]: text };
        const replayed = readThroughLens(
          lensBetween(middle, client),
          readThroughLens(lensBetween(today, middle), stored),
        );
        expect(replayed).toEqual({ [F(0x10)]: '9e-7' });
        expect(readThroughLens(lensBetween(today, client), stored)).toEqual(replayed);
      }
    },
  );

  it('S. text a client cannot hold as written (" 7 " as a uid) reads trimmed, or as its exact number, as a replay does', () => {
    // Property 5, found with LENS_PROPERTY_SEED=3607 (run 6,422; through code) and 6102 (run 7,644; through rich
    // text) at 50,000 runs, after the Q fix. V: uid; an intermediate version: integer; today: text " 7 ". The
    // replay reads " 7 " as the integer 7, then as the uid "7"; the direct lens reads " 7 " as a uid, which the
    // uid pattern refuses (spaces). Fixed: every text-reading client tries the text as written, trimmed, then
    // its exact number text (values.ts `textCandidates`); the first that fits wins.
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'uid' }]));
    const middle = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'integer' }]));
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n' }]));
    const stored = { [F(0x10)]: ' 7 ' };
    const replayed = readThroughLens(
      lensBetween(middle, client),
      readThroughLens(lensBetween(today, middle), stored),
    );
    expect(replayed).toEqual({ [F(0x10)]: '7' });
    expect(readThroughLens(lensBetween(today, client), stored)).toEqual(replayed);
    const read = (field: Spec, value: string) =>
      readThroughLens(lensBetween(today, schemaOf(pageOf([{ ...field, id: F(0x10), apiKey: 'n' }]))), {
        [F(0x10)]: value,
      })[F(0x10)];
    expect(read({ id: '', apiKey: '', type: 'uid' }, ' 7 ')).toBe('7');
    expect(read({ id: '', apiKey: '', type: 'slug' }, ' 7 ')).toBe('7');
    expect(read({ id: '', apiKey: '', type: 'slug' }, '007')).toBe('007');
    expect(read({ id: '', apiKey: '', type: 'enum', settings: enumSettings(['7'], false) }, ' 7 ')).toBe('7');
    expect(read({ id: '', apiKey: '', type: 'enum', settings: enumSettings(['7'], false) }, '007')).toBe('7');
    expect(read({ id: '', apiKey: '', type: 'biginteger' }, '007')).toBe('7');
    // A pattern that refuses spaces: no spelling fits, null.
    expect(read({ id: '', apiKey: '', type: 'slug' }, ' a b ')).toBeUndefined();
    expect(read({ id: '', apiKey: '', type: 'uid' }, ' a b ')).toBeUndefined();
    // Written as is wins when it fits: a string keeps its spaces.
    expect(read({ id: '', apiKey: '', type: 'string' }, ' 7 ')).toBe(' 7 ');
  });

  it.fails('T. a time read as text: "10:30" directly, "10:30:00.000" through a time version', () => {
    // Property 5, found with LENS_PROPERTY_SEED=6001 at 50,000 runs (run 17,899). V: code; an intermediate
    // version: time; today: text "10:30". The replay canonicalizes through the time ("10:30:00.000"); the direct
    // lens keeps the stored text. Same time, two spellings; cosmetic, like R (the direct read is the exact one).
    const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'code' }]));
    const middle = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'time' }]));
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'text' }]));
    const stored = { [F(0x10)]: '10:30' };
    const replayed = readThroughLens(
      lensBetween(middle, client),
      readThroughLens(lensBetween(today, middle), stored),
    );
    expect(readThroughLens(lensBetween(today, client), stored)).toEqual(replayed);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Bounded work on any stored text (review: `exactNumberText` built a string as long as the exponent said)

const ADVERSARIAL_TEXT = [
  '1e-400000000',
  '0e400000000',
  ' -0E-400000000 ',
  '1e999999999999',
  '-1e-9999999999',
];

describe('reading numeric text is bounded', () => {
  it('refuses the exponents a review found, before building anything', () => {
    for (const text of ADVERSARIAL_TEXT) {
      expect(exactNumberText(text, false)).toBeUndefined();
      expect(exactNumberText(text, true)).toBeUndefined();
    }
    expect(exactNumberText('1e400', false)).toBeUndefined(); // not finite
    expect(exactNumberText(`1e-${MAX_NUMBER_EXPONENT + 1}`, false)).toBeUndefined();
    expect(exactNumberText(`1e-${MAX_NUMBER_EXPONENT}`, false)).toBe(
      `0.${'0'.repeat(MAX_NUMBER_EXPONENT - 1)}1`,
    );
    expect(exactNumberText('1e0000000000000000003', false)).toBe('1000'); // leading zeros of the exponent
    expect(exactNumberText('9'.repeat(64), true)).toBe('9'.repeat(64));
    expect(exactNumberText('9'.repeat(65), true)).toBeUndefined();
    expect(exactNumberText(` ${'9'.repeat(64)} `, true)).toBe('9'.repeat(64));
    expect(exactNumberText('0x10', true)).toBe('16');
    expect(plainNumber(Number.NaN)).toBe('NaN');
    expect(plainNumber(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });

  it('reads the adversarial stored texts quickly: null for exact-digit clients', () => {
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'text' }]));
    for (const type of [
      'decimal',
      'biginteger',
      'number',
      'integer',
      'uid',
      'slug',
      'email',
      'url',
      'date',
    ]) {
      const client = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type }]));
      for (const text of ADVERSARIAL_TEXT) {
        const started = performance.now();
        const read = readThroughLens(lensBetween(today, client), { [F(0x10)]: text })[F(0x10)];
        expect(performance.now() - started).toBeLessThan(100);
        // Number and integer clients read them as `convertType` text → number does (a float: "1e-400000000" is
        // 0), cheaply; text clients whose pattern accepts the text as written (a uid) read it unchanged; the
        // exact-digit clients and a date refuse them.
        if (type === 'decimal' || type === 'biginteger' || type === 'date') {
          expect(read).toBeUndefined();
        }
      }
    }
  });
});

const BOUNDED_CLIENTS: Spec[] = [
  'string',
  'text',
  'code',
  'slug',
  'email',
  'url',
  'uid',
  'date',
  'datetime',
  'time',
  'number',
  'integer',
  'decimal',
  'biginteger',
  'boolean',
  'richtext',
].map((type) => ({ id: F(0x10), apiKey: 'n', type }));
BOUNDED_CLIENTS.push(
  { id: F(0x10), apiKey: 'n', type: 'enum', settings: enumSettings(['7', 'a', '0'], false) },
  { id: F(0x10), apiKey: 'n', type: 'enum', settings: enumSettings(['7', 'a', '0'], true) },
);

/** Characters a read returned: text, items of a list, a number's digits, or the text of a rich-text document. */
const outputLength = (value: unknown): number => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + outputLength(item), 0);
  }
  const text = plainTextOf(value);
  if (text !== undefined) {
    return text.length;
  }
  return typeof value === 'number' || typeof value === 'boolean'
    ? String(value).length
    : JSON.stringify(value).length;
};

const adversarialStringArb = fc.oneof(
  fc.string({ maxLength: 10_000 }),
  fc.string({ unit: 'grapheme-ascii', maxLength: 200 }),
  fc
    .tuple(
      fc.constantFrom('', ' ', '\t', '  '),
      fc.constantFrom('', '-', '+'),
      fc.nat({ max: 5_000 }),
      fc.constantFrom('', '.', '.5'),
      fc.constantFrom('', 'e', 'E', 'e-', 'e+', 'E-'),
      fc.oneof(fc.nat(), fc.constantFrom(400, 401, 400000000, 999999999999)),
      fc.constantFrom('', ' '),
      fc.constantFrom('0', '9', '1'),
    )
    .map(
      ([pad, sign, length, point, marker, exponent, trail, digit]) =>
        `${pad}${sign}${digit.repeat(length + 1)}${point}${marker === '' ? '' : `${marker}${exponent}`}${trail}`,
    ),
);

describe('schema lens properties: bounded reads', { timeout: 300_000 }, () => {
  it('13. any stored text up to 10,000 characters reads, through any client type, in bounded time and size', () => {
    const today = schemaOf(pageOf([{ id: F(0x10), apiKey: 'n', type: 'text' }]));
    const lenses = BOUNDED_CLIENTS.map((spec) => ({
      spec,
      lens: lensBetween(today, schemaOf(pageOf([spec]))),
    }));
    fc.assert(
      fc.property(adversarialStringArb, (text) => {
        for (const { spec, lens } of lenses) {
          const started = performance.now();
          const read = readThroughLens(lens, { [F(0x10)]: text })[F(0x10)];
          const elapsed = performance.now() - started;
          const message = `${String(spec.type)} ← ${JSON.stringify(text.slice(0, 80))} (${text.length} chars)`;
          expect(elapsed, message).toBeLessThan(250);
          expect(outputLength(read), message).toBeLessThanOrEqual(text.length + MAX_EXACT_NUMBER_LENGTH);
        }
      }),
      { numRuns: Math.max(100, Math.round(RUNS / 5)) },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Round trips through a version, with fields the client reads but cannot write (single pairing per list)

const PAIR_X = F(0xd1);
const PAIR_Y = F(0xd2);
const PAIR = { v: F(0x60), w: F(0x61), t: F(0x62), h: F(0x63), yv: F(0x64), yw: F(0x65) };

/**
 * Component X holds a writable `v`, `w` (number at V, integer today) and `t` (string at V, text today), which a
 * client on V reads but cannot write (their type changed), and a private `h`. Y holds `v` and `w` alike. The
 * model holds X repeatable (`items`) and a zone of X and Y (`blocks`).
 */
const pairSchemas = () => {
  const x = (atV: boolean) =>
    componentOf(PAIR_X, 'x', [
      { id: PAIR.v, apiKey: 'v' },
      { id: PAIR.w, apiKey: 'w', type: atV ? 'number' : 'integer' },
      { id: PAIR.t, apiKey: 't', type: atV ? 'string' : 'text' },
      { id: PAIR.h, apiKey: 'h', public: false },
    ]);
  const y = (atV: boolean) =>
    componentOf(PAIR_Y, 'y', [
      { id: PAIR.yv, apiKey: 'v' },
      { id: PAIR.yw, apiKey: 'w', type: atV ? 'number' : 'integer' },
    ]);
  const model = pageOf([
    { id: ITEMS, apiKey: 'items', type: 'component', settings: { component: PAIR_X, repeatable: true } },
    { id: BLOCKS, apiKey: 'blocks', type: 'dynamiczone', settings: { components: [PAIR_X, PAIR_Y] } },
  ]);
  return { today: schemaOf(model, [x(false), y(false)]), atV: schemaOf(model, [x(true), y(true)]) };
};

type PairItem = { kind: 'x' | 'y'; v: string; w: boolean; t: boolean; h: boolean };

/** A stored item; its unwritable and hidden values name it (`w` 100 + index, `t3`, `h3`). */
const pairStored = (item: PairItem, index: number, zone: boolean): Record<string, unknown> =>
  item.kind === 'x'
    ? {
        ...(zone ? { [COMPONENT_KEY]: PAIR_X } : {}),
        [PAIR.v]: item.v,
        ...(item.w ? { [PAIR.w]: 100 + index } : {}),
        ...(item.t ? { [PAIR.t]: `t${index}` } : {}),
        ...(item.h ? { [PAIR.h]: `h${index}` } : {}),
      }
    : {
        [COMPONENT_KEY]: PAIR_Y,
        [PAIR.yv]: item.v,
        ...(item.w ? { [PAIR.yw]: 100 + index } : {}),
      };

const pairListArb = (zone: boolean) =>
  fc.array(
    fc.record({
      kind: zone ? fc.constantFrom<'x' | 'y'>('x', 'y') : fc.constant<'x' | 'y'>('x'),
      // A tiny writable part: items equal in everything the client may write are common.
      v: fc.constantFrom('p', 'q'),
      w: fc.boolean(),
      t: fc.boolean(),
      h: fc.boolean(),
    }),
    { maxLength: 5 },
  );

type PairOp =
  | { kind: 'structure'; kept: number[]; inserts: Array<{ at: number; kind: 'x' | 'y'; v: string }> }
  | { kind: 'inPlace'; edits: Array<string | undefined> };

/** Deletes, inserts and reorders of untouched items; or edits of the writable part where items stand. */
const pairOpArb = (stored: PairItem[], zone: boolean): fc.Arbitrary<PairOp> =>
  fc.oneof(
    fc.record({
      kind: fc.constant('structure' as const),
      kept: fc.shuffledSubarray(
        stored.map((_, index) => index),
        { minLength: 0, maxLength: stored.length },
      ),
      inserts: fc.array(
        fc.record({
          at: fc.nat({ max: 6 }),
          kind: zone ? fc.constantFrom<'x' | 'y'>('x', 'y') : fc.constant<'x' | 'y'>('x'),
          v: fc.constantFrom('p', 'q', 'n'),
        }),
        { maxLength: 2 },
      ),
    }),
    fc.record({
      kind: fc.constant('inPlace' as const),
      edits: fc.array(fc.option(fc.constantFrom('p', 'q', 'e'), { nil: undefined }), {
        minLength: stored.length,
        maxLength: stored.length,
      }),
    }),
  );

type PairMode = 'lensRead' | 'lensUpdateOnly' | 'noLens';

/** The sent list and, per sent item, the stored item it is meant to continue (-1: new). */
const pairBody = (
  mode: PairMode,
  read: unknown[],
  stored: PairItem[],
  op: PairOp,
  zone: boolean,
): { sent: Array<Record<string, unknown>>; origins: number[] } => {
  const asSent = (index: number, v?: string): Record<string, unknown> => {
    const item = (read[index] ?? {}) as Record<string, unknown>;
    if (mode === 'lensUpdateOnly') {
      // A caller that may not read sends only what it may write.
      const kind = (stored[index] as PairItem).kind;
      return { ...(zone ? { [COMPONENT_KEY]: kind } : {}), v: v ?? item.v };
    }
    // Every field it read, the unwritable ones exactly as read.
    const sent = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null));
    return v === undefined ? sent : { ...sent, v };
  };
  if (op.kind === 'inPlace') {
    return {
      sent: read.map((_, index) => asSent(index, op.edits[index])),
      origins: read.map((_, index) => index),
    };
  }
  const sent = op.kept.map((index) => asSent(index));
  const origins = [...op.kept];
  for (const insert of op.inserts) {
    const at = Math.min(insert.at, sent.length);
    sent.splice(at, 0, { ...(zone ? { [COMPONENT_KEY]: insert.kind } : {}), v: insert.v });
    origins.splice(at, 0, -1);
  }
  return { sent, origins };
};

/** A write through the version (or none), as `updateDeliveryEntry` runs it, with the pairing made once. */
const writePairs = (
  mode: PairMode,
  stored: ContentData,
  body: Record<string, unknown>,
  options: { seesStored?: boolean } = {},
) => {
  const { today, atV } = pairSchemas();
  const mayRead = mode !== 'lensUpdateOnly';
  const all = fieldsById(today);
  const componentReadable = (fieldId: string) => {
    const field = all.get(fieldId)?.field;
    return mayRead && field !== undefined && field.public && !field.deprecated;
  };
  const outcome = deliveryWrite({
    today,
    client: mode === 'noLens' ? null : atV,
    stored,
    body,
    mayRead,
    ...(options.seesStored === undefined ? {} : { seesStored: options.seesStored }),
    readable: () => mayRead,
    componentReadable,
  });
  return {
    issues: outcome.issues,
    refusedBy: outcome.refusedBy,
    /** Item issues the lens's translation found, whatever refused first. */
    itemIssues: outcome.result?.itemIssues ?? [],
    written: outcome.written === null ? null : (withoutStoredItemIds(outcome.written) as ContentData),
    withIds: outcome.written,
  };
};

/** The index a carried value names (`w` 103, `t3`, `h3` → 3). */
const originOf = (value: unknown): number | undefined =>
  typeof value === 'number' ? value - 100 : typeof value === 'string' ? Number(value.slice(1)) : undefined;

const pairCaseArb = fc
  .tuple(
    pairListArb(false),
    pairListArb(true),
    fc.constantFrom<PairMode>('lensRead', 'lensUpdateOnly', 'noLens'),
  )
  .chain(([items, blocks, mode]) =>
    fc.record({
      mode: fc.constant(mode),
      items: fc.constant(items),
      blocks: fc.constant(blocks),
      itemsOp: pairOpArb(items, false),
      blocksOp: pairOpArb(blocks, true),
    }),
  );

type PairCase = {
  mode: PairMode;
  items: PairItem[];
  blocks: PairItem[];
  itemsOp: PairOp;
  blocksOp: PairOp;
};

const runPairCase = async ({ mode, items, blocks, itemsOp, blocksOp }: PairCase) => {
  const { today, atV } = pairSchemas();
  const client = mode === 'noLens' ? today : atV;
  const stored: ContentData = {
    ...(items.length > 0 ? { [ITEMS]: items.map((item, index) => pairStored(item, index, false)) } : {}),
    ...(blocks.length > 0 ? { [BLOCKS]: blocks.map((item, index) => pairStored(item, index, true)) } : {}),
  };
  const read = await projectThrough(today, mode === 'noLens' ? null : client, stored, deliveryMask(today));
  const itemsBody = pairBody(mode, (read.items ?? []) as unknown[], items, itemsOp, false);
  const blocksBody = pairBody(mode, (read.blocks ?? []) as unknown[], blocks, blocksOp, true);
  const body = { items: itemsBody.sent, blocks: blocksBody.sent };
  const outcome = writePairs(mode, stored, body);
  const message = `mode ${mode}\n  ops ${JSON.stringify({ itemsOp, blocksOp, origins: { items: itemsBody.origins, blocks: blocksBody.origins } })}\n  stored ${JSON.stringify(stored)}\n  read ${JSON.stringify(read)}\n  body ${JSON.stringify(body)}\n  outcome ${JSON.stringify({ refusedBy: outcome.refusedBy, issues: outcome.issues, written: outcome.withIds })}`;
  const problems: string[] = [];
  if (outcome.written === null || outcome.withIds === null) {
    // The documented refusal (plan item-ids, strict alignment): AMBIGUOUS_ITEMS at the list only (a gap with
    // leftovers on both sides, a caller that cannot see the items it replaces, or a read-only value sent back as
    // read on an item that is no exact-match continuation: X2, AB). Any other refusal of a body sent back as read
    // is wrong.
    problems.push(...strictRefusalProblems(outcome.issues));
    return { problems, message, refused: true };
  }
  const storedIds = storedWithIds(today, stored);
  const lists = [
    ['items', ITEMS, items, itemsBody.origins, false],
    ['blocks', BLOCKS, blocks, blocksBody.origins, true],
  ] as const;
  // Which written items substitute for a stored item: continue one whose view differs from what was sent (the
  // documented P, as the alignment reads it: a stored item read as edited where it stood).
  const substitutes = new Map<string, Set<number>>();
  for (const [name, fieldId] of lists) {
    const continued = continuedIndexes(storedIds, outcome.withIds, fieldId);
    const readList = (read[name] ?? []) as unknown[];
    const sentList = body[name];
    substitutes.set(
      name,
      new Set(
        continued.flatMap((stored, position) =>
          stored !== -1 && callerView(readList[stored]) !== callerView(sentList[position]) ? [position] : [],
        ),
      ),
    );
  }
  // The strict rule: an item continues a stored item it does not equal only in a pure edit in place, at its
  // place; the only item of its view in both lists continues that one; no gap keeps new and deleted items.
  for (const [name, fieldId] of lists) {
    problems.push(
      ...strictListProblems(
        name,
        strictListOf(body[name], (read[name] ?? []) as unknown[]),
        continuedIndexes(storedIds, outcome.withIds, fieldId),
      ),
    );
  }
  if (mode !== 'lensUpdateOnly') {
    // Read back through the version: equal to what was sent, item by item, in order (but a substitute, which
    // also shows the read-only values of the item it continues).
    const back = await projectThrough(
      today,
      mode === 'noLens' ? null : client,
      outcome.written,
      deliveryMask(today),
    );
    for (const [name] of lists) {
      const got = (back[name] ?? []) as unknown[];
      const sent = body[name];
      if (got.length !== sent.length) {
        problems.push(`${name}: ${got.length} items read back for ${sent.length} sent`);
        continue;
      }
      sent.forEach((item, position) => {
        if (
          !substitutes.get(name)?.has(position) &&
          !same(withoutEmpties(got[position]), withoutEmpties(item))
        ) {
          problems.push(
            `${name}#${position} read back ${JSON.stringify(got[position])} ≠ sent ${JSON.stringify(item)}`,
          );
        }
      });
    }
  }
  // Values follow the item ID: every carried value of a written item comes whole from the stored item it
  // continues; an item unambiguous to the caller (the only one that looks like it, in both lists) continues
  // its own.
  for (const [name, fieldId, storedList, origins, zone] of lists) {
    const continued = continuedIndexes(storedIds, outcome.withIds, fieldId);
    const written = (outcome.written[fieldId] ?? []) as Array<Record<string, unknown>>;
    const seen = (index: number) => {
      const item = storedList[index] as PairItem;
      const data = pairStored(item, index, zone);
      return mode === 'lensUpdateOnly'
        ? canonicalJson({ kind: item.kind, v: item.v })
        : canonicalJson({
            kind: item.kind,
            v: item.v,
            w: data[item.kind === 'x' ? PAIR.w : PAIR.yw] ?? null,
            t: data[PAIR.t] ?? null,
          });
    };
    const sentView = (sent: Record<string, unknown>) =>
      mode === 'lensUpdateOnly'
        ? canonicalJson({ kind: sent[COMPONENT_KEY] ?? 'x', v: sent.v })
        : canonicalJson({
            kind: sent[COMPONENT_KEY] ?? 'x',
            v: sent.v,
            w: sent.w ?? null,
            t: sent.t ?? null,
          });
    written.forEach((item, position) => {
      if (mode === 'lensUpdateOnly' && item[PAIR.h] !== undefined) {
        problems.push(
          `${name}#${position}: an update-only caller left h out, yet it holds ${String(item[PAIR.h])}`,
        );
      }
      const carried = [
        item[PAIR.w] ?? item[PAIR.yw],
        ...(mode === 'noLens' ? [] : [item[PAIR.t]]),
        ...(mode === 'lensUpdateOnly' ? [] : [item[PAIR.h]]),
      ].filter((value) => value !== undefined);
      const sources = new Set(carried.map(originOf));
      const [source] = [...sources];
      const continuing = continued[position] ?? -1;
      if (sources.size > 1) {
        problems.push(`${name}#${position}: values of several stored items ${JSON.stringify(item)}`);
      } else if (source !== undefined && source !== continuing && mode !== 'noLens') {
        problems.push(`${name}#${position}: continues stored ${continuing}, holds stored ${source}'s values`);
      }
      const origin = origins[position] ?? -1;
      const sentList = body[name];
      const unambiguous =
        origin >= 0 &&
        storedList.filter((_, index) => seen(index) === seen(origin)).length === 1 &&
        sentList.filter((candidate) => sentView(candidate) === sentView(sentList[position] ?? {})).length ===
          1 &&
        sentView(sentList[position] ?? {}) === seen(origin);
      if (unambiguous && continuing !== origin) {
        problems.push(
          `${name}#${position}: sent back unchanged as stored ${origin}, continues ${continuing}`,
        );
      }
    });
  }
  return { problems, message, refused: false };
};

describe('round trips through a version with read-only fields', { timeout: 600_000 }, () => {
  it('14. delete, insert, reorder or edit in place through a version: accepted, reads back as sent, values stay with their items', async () => {
    await fc.assert(
      fc.asyncProperty(pairCaseArb, async (input) => {
        const { problems, message } = await runPairCase(input);
        expect(problems, message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  /** Two stored items; `same`: equal in everything the caller reads (else they differ in read-only fields). */
  const twoItems = (same: boolean) => ({
    [ITEMS]: [0, 1].map((index) =>
      pairStored({ kind: 'x', v: 'p', w: !same, t: !same, h: true }, index, false),
    ),
  });
  /** What a client of the version read of `stored`, items in `order`, with or without their `id`. */
  const echo = async (stored: ContentData, order: number[], ids: boolean) => {
    const { today, atV } = pairSchemas();
    const read = await projectThrough(today, atV, stored, deliveryMask(today), { ids: true });
    const list = read.items as Array<Record<string, unknown>>;
    return {
      items: order.map((index) =>
        Object.fromEntries(
          Object.entries(list[index] ?? {}).filter(([key, value]) => value !== null && (ids || key !== 'id')),
        ),
      ),
      blocks: [],
    };
  };
  const hOf = (outcome: { written: ContentData | null }) =>
    ((outcome.written?.[ITEMS] ?? []) as Array<Record<string, unknown>>).map((item) => item[PAIR.h]);

  it('14a. delete the first of two items equal in what the client may write: certain when they differ in a read-only field; refused when identical to the caller, without IDs; certain with IDs', async () => {
    const differ = twoItems(false);
    expect(hOf(writePairs('lensRead', differ, await echo(differ, [1], false)))).toEqual(['h1']);
    expect(hOf(writePairs('lensRead', differ, await echo(differ, [1], true)))).toEqual(['h1']);
    const identical = twoItems(true);
    const noIds = writePairs('lensRead', identical, await echo(identical, [1], false));
    expect(noIds.issues.map((issue) => issue.code)).toEqual(['AMBIGUOUS_ITEMS']);
    expect(hOf(writePairs('lensRead', identical, await echo(identical, [1], true)))).toEqual(['h1']);
  });

  it('14b. swap two items equal in what the client may write: certain when they differ in a read-only field; a no-op when identical to the caller, without IDs; certain with IDs', async () => {
    const differ = twoItems(false);
    expect(hOf(writePairs('lensRead', differ, await echo(differ, [1, 0], false)))).toEqual(['h1', 'h0']);
    expect(hOf(writePairs('lensRead', differ, await echo(differ, [1, 0], true)))).toEqual(['h1', 'h0']);
    const identical = twoItems(true);
    // Indistinguishable to the caller: swapping them sends the same list; nothing moves.
    expect(hOf(writePairs('lensRead', identical, await echo(identical, [1, 0], false)))).toEqual([
      'h0',
      'h1',
    ]);
    expect(hOf(writePairs('lensRead', identical, await echo(identical, [1, 0], true)))).toEqual(['h1', 'h0']);
  });

  it('14c. an update-only caller without IDs is refused (it cannot see the items it replaces); with IDs, certain', async () => {
    const stored = twoItems(true);
    const { today } = pairSchemas();
    const ids = ((storedWithIds(today, stored)[ITEMS] ?? []) as Array<Record<string, unknown>>).map(
      (item) => item.__id,
    );
    const refused = writePairs('lensUpdateOnly', stored, { items: [{ v: 'p' }], blocks: [] });
    expect(refused.issues.map((issue) => issue.code)).toEqual(['AMBIGUOUS_ITEMS']);
    const certain = writePairs('lensUpdateOnly', stored, { items: [{ id: ids[1], v: 'p' }], blocks: [] });
    expect(certain.issues).toEqual([]);
    expect((certain.withIds?.[ITEMS] as Array<Record<string, unknown>>).map((item) => item.__id)).toEqual([
      ids[1],
    ]);
  });

  it('14d. without draft access: a value sent for a read-only field inside a component is refused; without IDs any non-empty list is refused; with IDs and the field left out, kept', async () => {
    // By decision: a caller that may not have read the draft cannot send back a value inside a component (it
    // must leave the field out), and (plan item-ids, decision 1) cannot replace items it cannot see without IDs.
    const stored = { [ITEMS]: [pairStored({ kind: 'x', v: 'p', w: true, t: true, h: false }, 0, false)] };
    const { today } = pairSchemas();
    const [id] = ((storedWithIds(today, stored)[ITEMS] ?? []) as Array<Record<string, unknown>>).map(
      (item) => item.__id,
    );
    const sent = writePairs(
      'lensRead',
      stored,
      { items: [{ id, v: 'p', w: 100, t: 't0' }], blocks: [] },
      { seesStored: false },
    );
    expect(sent.issues.length).toBeGreaterThan(0);
    const noIds = writePairs('lensRead', stored, { items: [{ v: 'p' }], blocks: [] }, { seesStored: false });
    expect(noIds.issues.map((issue) => issue.code)).toEqual(['AMBIGUOUS_ITEMS']);
    const left = writePairs(
      'lensRead',
      stored,
      { items: [{ id, v: 'p' }], blocks: [] },
      { seesStored: false },
    );
    expect(left.issues).toEqual([]);
    expect(left.written?.[ITEMS]).toEqual(stored[ITEMS]);
    expect(writePairs('lensRead', stored, { items: [], blocks: [] }, { seesStored: false }).issues).toEqual(
      [],
    );
  });

  it('U. an item edited in place into a copy of another item keeps its own hidden value, with or without IDs', async () => {
    // Was a counterexample (h0 deleted). Plan item-ids: no unique pairs; one optimal alignment costs 1, sent 0
    // continues stored 0. With IDs, certain.
    const stored = {
      [ITEMS]: [
        pairStored({ kind: 'x', v: 'p', w: false, t: false, h: true }, 0, false),
        pairStored({ kind: 'x', v: 'q', w: false, t: false, h: false }, 1, false),
      ],
    };
    for (const mode of ['lensRead', 'noLens'] as const) {
      const written = writePairs(mode, stored, { items: [{ v: 'q' }, { v: 'q' }], blocks: [] }).written;
      expect(written?.[ITEMS], mode).toEqual([{ [PAIR.v]: 'q', [PAIR.h]: 'h0' }, { [PAIR.v]: 'q' }]);
    }
    const { today } = pairSchemas();
    const ids = ((storedWithIds(today, stored)[ITEMS] ?? []) as Array<Record<string, unknown>>).map(
      (item) => item.__id,
    );
    const withIds = writePairs('lensRead', stored, {
      items: [
        { id: ids[0], v: 'q' },
        { id: ids[1], v: 'q' },
      ],
      blocks: [],
    });
    expect(withIds.written?.[ITEMS]).toEqual([{ [PAIR.v]: 'q', [PAIR.h]: 'h0' }, { [PAIR.v]: 'q' }]);
  });

  /** [{v:'p', t:'t0', h:'h0'}, {v:'q', t:'t1', h:'h1'}] (h private; t read-only through the version). */
  const vStored = () => ({
    [ITEMS]: [
      pairStored({ kind: 'x', v: 'p', w: false, t: true, h: true }, 0, false),
      pairStored({ kind: 'x', v: 'q', w: false, t: true, h: true }, 1, false),
    ],
  });
  const vIds = () =>
    ((storedWithIds(pairSchemas().today, vStored())[ITEMS] ?? []) as Array<Record<string, unknown>>).map(
      (item) => item.__id,
    );

  it('V. an update-only caller deletes an item: refused without IDs; with IDs, the other item keeps what its version cannot write', () => {
    // Was a counterexample (t1 lost). Plan item-ids, decision 1: a caller that cannot see the items it replaces
    // is refused without IDs.
    const refused = writePairs('lensUpdateOnly', vStored(), { items: [{ v: 'q' }], blocks: [] });
    expect(refused.issues.map((issue) => issue.code)).toEqual(['AMBIGUOUS_ITEMS']);
    const [, second] = vIds();
    const written = writePairs('lensUpdateOnly', vStored(), {
      items: [{ id: second, v: 'q', h: 'h1' }],
      blocks: [],
    });
    expect(written.written?.[ITEMS]).toEqual([{ [PAIR.v]: 'q', [PAIR.t]: 't1', [PAIR.h]: 'h1' }]);
  });

  it('V2. an update-only caller swaps two items: refused without IDs; with IDs, what its version cannot write stays with each item', () => {
    // Was a counterexample (t0 and t1 attached to the wrong items).
    const refused = writePairs('lensUpdateOnly', vStored(), { items: [{ v: 'q' }, { v: 'p' }], blocks: [] });
    expect(refused.issues.map((issue) => issue.code)).toEqual(['AMBIGUOUS_ITEMS']);
    const [first, second] = vIds();
    const written = writePairs('lensUpdateOnly', vStored(), {
      items: [
        { id: second, v: 'q', h: 'h1' },
        { id: first, v: 'p', h: 'h0' },
      ],
      blocks: [],
    });
    expect(written.written?.[ITEMS]).toEqual([
      { [PAIR.v]: 'q', [PAIR.t]: 't1', [PAIR.h]: 'h1' },
      { [PAIR.v]: 'p', [PAIR.t]: 't0', [PAIR.h]: 'h0' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Item IDs and never-guess pairing (plan item-ids)

const IDF = {
  xv: F(0x70),
  xw: F(0x71),
  xh: F(0x72),
  xd: F(0x73),
  xu: F(0x74),
  sub: F(0x75),
  zv: F(0x76),
  zh: F(0x77),
  yv: F(0x78),
  yh: F(0x79),
};
const ID_X = F(0xe1);
const ID_Y = F(0xe2);
const ID_Z = F(0xe3);

/**
 * X: a writable `xv`, `xw` (number at V, integer today: read-only through V), a private `xh`, a deprecated
 * `xd`, `xu` (added since V), and `sub`, a repeatable Z (`zv`, private `zh`). Y: `yv`, private `yh`. The model
 * holds X repeatable (`items`) and a zone of X and Y (`blocks`). With `hidden: false`, nothing is private or
 * deprecated and V equals today but for an added top-level field (nothing a caller cannot see).
 */
const idSchemas = ({ hidden = true }: { hidden?: boolean } = {}) => {
  const z = componentOf(ID_Z, 'z', [
    { id: IDF.zv, apiKey: 'zv' },
    { id: IDF.zh, apiKey: 'zh', public: !hidden },
  ]);
  const x = (atV: boolean) =>
    componentOf(ID_X, 'x', [
      { id: IDF.xv, apiKey: 'xv' },
      ...(hidden ? [{ id: IDF.xw, apiKey: 'xw', type: atV ? 'number' : 'integer' }] : []),
      { id: IDF.xh, apiKey: 'xh', public: !hidden },
      ...(hidden ? [{ id: IDF.xd, apiKey: 'xd', deprecated: true }] : []),
      ...(atV && hidden ? [] : [{ id: IDF.xu, apiKey: 'xu' }]),
      { id: IDF.sub, apiKey: 'sub', type: 'component', settings: { component: ID_Z, repeatable: true } },
    ]);
  const y = componentOf(ID_Y, 'y', [
    { id: IDF.yv, apiKey: 'yv' },
    { id: IDF.yh, apiKey: 'yh', public: !hidden },
  ]);
  const model = (atV: boolean) =>
    pageOf([
      { id: ITEMS, apiKey: 'items', type: 'component', settings: { component: ID_X, repeatable: true } },
      { id: BLOCKS, apiKey: 'blocks', type: 'dynamiczone', settings: { components: [ID_X, ID_Y] } },
      ...(atV ? [] : [{ id: F(0x12), apiKey: 'added' }]),
    ]);
  return { today: schemaOf(model(false), [x(false), y, z]), atV: schemaOf(model(true), [x(true), y, z]) };
};

type IdAccess = 'public' | 'all' | 'updateOnly' | 'noDraft';
type IdMode = { version: boolean; access: IdAccess };
const ID_MODES: IdMode[] = [false, true].flatMap((version) =>
  (['public', 'all', 'updateOnly', 'noDraft'] as const).map((access) => ({ version, access })),
);

type SubSpec = { v: string; h: boolean };
type IdItem = {
  kind: 'x' | 'y';
  v: string;
  w: boolean;
  h: boolean;
  d: boolean;
  u: boolean;
  sub: SubSpec[];
  /** Stored before item IDs: no `__id`, the read derives one. */
  legacy: boolean;
};

const idItemArb = (zone: boolean): fc.Arbitrary<IdItem> =>
  fc.record({
    kind: zone ? fc.constantFrom<'x' | 'y'>('x', 'y') : fc.constant<'x' | 'y'>('x'),
    // A tiny visible part: duplicates are common.
    v: fc.constantFrom('p', 'q'),
    w: fc.boolean(),
    h: fc.boolean(),
    d: fc.boolean(),
    u: fc.boolean(),
    sub: fc.array(fc.record({ v: fc.constantFrom('a', 'b'), h: fc.boolean() }), { maxLength: 3 }),
    legacy: fc.boolean(),
  });

/** A stored item; every hidden value names its item (`h:items:2`, `zh:items:2:1`), `__id` unless legacy. */
const idStored = (
  item: IdItem,
  list: 'items' | 'blocks',
  index: number,
  opts: { hidden: boolean; tags?: string; retag?: (field: 'h' | 'd' | 'u') => boolean },
): Record<string, unknown> => {
  const plain = `${list}:${index}`;
  // A suffix (a redrawn value) only on the fields `retag` names: those hidden from the caller.
  const tagOf = (field: 'h' | 'd' | 'u') => (opts.retag?.(field) ? `${plain}${opts.tags ?? ''}` : plain);
  const id = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;
  const base = list === 'items' ? 0x100 : 0x200;
  const own = item.legacy ? {} : { __id: id(base + index) };
  if (item.kind === 'y') {
    return {
      [COMPONENT_KEY]: ID_Y,
      ...own,
      [IDF.yv]: item.v,
      ...(item.h ? { [IDF.yh]: `yh:${tagOf('h')}` } : {}),
    };
  }
  return {
    ...(list === 'blocks' ? { [COMPONENT_KEY]: ID_X } : {}),
    ...own,
    [IDF.xv]: item.v,
    ...(item.w && opts.hidden ? { [IDF.xw]: 1000 + base + index } : {}),
    ...(item.h ? { [IDF.xh]: `xh:${tagOf('h')}` } : {}),
    ...(item.d && opts.hidden ? { [IDF.xd]: `xd:${tagOf('d')}` } : {}),
    ...(item.u ? { [IDF.xu]: `xu:${tagOf('u')}` } : {}),
    ...(item.sub.length > 0
      ? {
          [IDF.sub]: item.sub.map((sub, position) => ({
            ...(item.legacy ? {} : { __id: id(base * 16 + index * 8 + position) }),
            [IDF.zv]: sub.v,
            ...(sub.h ? { [IDF.zh]: `zh:${tagOf('h')}:${position}` } : {}),
          })),
        }
      : {}),
  };
};

/** One edit of a list: which read items survive in what order, their edits, and what is inserted where. */
type IdScript = {
  kept: number[];
  /** Per read item: a new visible value, or undefined to leave it. */
  edits: Array<string | undefined>;
  /** Per read item: how its `sub` list changes (survivors in order, one inserted value or none). */
  subs: Array<{ kept: number[]; insert?: string }>;
  inserts: Array<{ at: number; kind: 'x' | 'y'; v: string; copyOf?: number }>;
};

const idScriptArb = (stored: IdItem[], zone: boolean): fc.Arbitrary<IdScript> =>
  fc.record({
    kept: fc.shuffledSubarray(
      stored.map((_, index) => index),
      { minLength: 0, maxLength: stored.length },
    ),
    edits: fc.tuple(
      ...stored.map(() => fc.option(fc.constantFrom('p', 'q', 'e'), { nil: undefined, freq: 2 })),
    ),
    subs: fc.tuple(
      ...stored.map((item) =>
        fc.record(
          {
            kept: fc.shuffledSubarray(
              item.sub.map((_, index) => index),
              { minLength: 0, maxLength: item.sub.length },
            ),
            insert: fc.constantFrom('a', 'n'),
          },
          { requiredKeys: ['kept'] },
        ),
      ),
    ),
    inserts: fc.array(
      fc.record(
        {
          at: fc.nat({ max: 6 }),
          kind: zone ? fc.constantFrom<'x' | 'y'>('x', 'y') : fc.constant<'x' | 'y'>('x'),
          v: fc.constantFrom('p', 'q', 'n'),
          copyOf: fc.nat({ max: 4 }),
        },
        { requiredKeys: ['at', 'kind', 'v'] },
      ),
      { maxLength: 2 },
    ),
  });

type IdCase = {
  mode: IdMode;
  items: IdItem[];
  blocks: IdItem[];
  itemsScript: IdScript;
  blocksScript: IdScript;
};

const idCaseArb = (modes: readonly IdMode[] = ID_MODES): fc.Arbitrary<IdCase> =>
  fc
    .tuple(
      fc.array(idItemArb(false), { maxLength: 4 }),
      fc.array(idItemArb(true), { maxLength: 4 }),
      fc.constantFrom(...modes),
    )
    .chain(([items, blocks, mode]) =>
      fc.record({
        mode: fc.constant(mode),
        items: fc.constant(items),
        blocks: fc.constant(blocks),
        itemsScript: idScriptArb(items, false),
        blocksScript: idScriptArb(blocks, true),
      }),
    );

/** Field access of a mode: component fields it reads, whether it reads at all, whether it saw the draft. */
const idAccessOf = (access: IdAccess, today: Schema) => {
  const all = fieldsById(today);
  const mayRead = access !== 'updateOnly';
  const componentReadable = (fieldId: string) => {
    const field = all.get(fieldId)?.field;
    if (!mayRead || field === undefined || field.deprecated) {
      return false;
    }
    return access === 'all' || field.public;
  };
  const mask: FieldMask =
    access === 'all'
      ? { mode: 'only', fieldIds: today.model.fields.map((field) => field.id), componentFields: 'all' }
      : deliveryMask(today);
  return { mayRead, seesStored: access !== 'noDraft', componentReadable, mask };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The body a client of `mode` sends for one list: the items it read (or, an update-only caller, the items it
 * wrote: their IDs and writable values), edited by `script`. With `ids`, every surviving item (and sub item)
 * echoes its `id` and every new one sends `id: null`; without, no `id` anywhere.
 */
const idListBody = (
  read: Array<Record<string, unknown>>,
  script: IdScript,
  ids: boolean,
  zone: boolean,
  /** Fields the client's version cannot write: a new item (a copy) leaves them out. */
  readOnly: readonly string[] = [],
): { sent: Array<Record<string, unknown>>; origins: number[] } => {
  const strip = (item: Record<string, unknown>, newItem: boolean): Record<string, unknown> => {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (value === null) {
        continue;
      }
      if (key === 'id') {
        if (ids) {
          output.id = newItem ? null : value;
        }
        continue;
      }
      output[key] = value;
    }
    if (ids && newItem) {
      output.id = null;
    }
    return output;
  };
  const sent: Array<Record<string, unknown>> = [];
  const origins: number[] = [];
  for (const index of script.kept) {
    const item = read[index] ?? {};
    const body = strip(item, false);
    const edit = script.edits[index];
    const visibleKey = 'xv' in item || item[COMPONENT_KEY] === 'x' || !zone ? 'xv' : 'yv';
    if (edit !== undefined) {
      body[visibleKey] = edit;
    }
    const subChange = script.subs[index];
    if (Array.isArray(item.sub) && subChange) {
      const subs = item.sub as Array<Record<string, unknown>>;
      const nextSubs = subChange.kept.map((position) => strip(subs[position] ?? {}, false));
      if (subChange.insert !== undefined) {
        nextSubs.push(strip({ zv: subChange.insert }, true));
      }
      body.sub = nextSubs;
    }
    sent.push(body);
    origins.push(index);
  }
  for (const insert of script.inserts) {
    const at = Math.min(insert.at, sent.length);
    const copied =
      insert.copyOf !== undefined &&
      read[insert.copyOf] &&
      (!zone || read[insert.copyOf]?.[COMPONENT_KEY] === insert.kind)
        ? omitKeys(strip(read[insert.copyOf] as Record<string, unknown>, true), readOnly)
        : null;
    // A copy of a read item (its nested items new too), or a fresh one.
    const item: Record<string, unknown> = copied
      ? {
          ...copied,
          ...(Array.isArray(copied.sub)
            ? { sub: (copied.sub as Array<Record<string, unknown>>).map((sub) => strip(sub, true)) }
            : {}),
        }
      : strip(
          {
            ...(zone ? { [COMPONENT_KEY]: insert.kind } : {}),
            [insert.kind === 'y' ? 'yv' : 'xv']: insert.v,
          },
          true,
        );
    sent.splice(at, 0, item);
    origins.splice(at, 0, -1);
  }
  return { sent, origins };
};

/**
 * What an update-only caller holds of the items it wrote (it reads nothing): their IDs and the values of the
 * fields it may write. Built from storage, as a write response's `itemIds` and its own last body would give it.
 */
const writerView = (
  today: Schema,
  client: Schema,
  withIds: Readonly<ContentData>,
  fieldId: string,
  zone: boolean,
) => {
  const writable = (componentId: string) => {
    const component = componentById(client, componentId);
    const todayComponent = componentById(today, componentId);
    return new Set(
      (component?.fields ?? [])
        .filter((field) => {
          const now = todayComponent?.fields.find((candidate) => candidate.id === field.id);
          return now !== undefined && !now.deprecated && now.type === field.type;
        })
        .map((field) => field.id),
    );
  };
  const toApi = (componentId: string, item: Record<string, unknown>): Record<string, unknown> => {
    const component = componentById(client, componentId);
    const keep = writable(componentId);
    const output: Record<string, unknown> = { id: item.__id };
    for (const field of component?.fields ?? []) {
      const value = item[field.id];
      if (!keep.has(field.id) || value === undefined) {
        continue;
      }
      output[field.apiKey] =
        field.type === 'component' && Array.isArray(value)
          ? (value as Array<Record<string, unknown>>).map((sub) => toApi(field.settings.component, sub))
          : value;
    }
    if (zone) {
      output[COMPONENT_KEY] = componentById(client, componentId)?.apiKey;
    }
    return output;
  };
  return ((withIds[fieldId] ?? []) as Array<Record<string, unknown>>).map((item) =>
    toApi(zone ? String(item[COMPONENT_KEY]) : ID_X, item),
  );
};

/** Keys a client of `mode` leaves out of component items. */
const idOmitted = (mode: IdMode): string[] => (mode.access === 'noDraft' && mode.version ? ['xw'] : []);

const omitKeys = (item: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(item)
      .filter(([key]) => !keys.includes(key))
      .map(([key, value]) => [
        key,
        Array.isArray(value)
          ? (value as unknown[]).map((entry: unknown) => (isObject(entry) ? omitKeys(entry, keys) : entry))
          : value,
      ]),
  );

type IdRun = {
  outcome: DeliveryWriteOutcome;
  storedIds: ContentData;
  read: Record<string, unknown>;
  body: { items: Array<Record<string, unknown>>; blocks: Array<Record<string, unknown>> };
  origins: { items: number[]; blocks: number[] };
  message: string;
};

const runIdCase = async (
  input: IdCase,
  { ids, hiddenTags = '', hidden = true }: { ids: boolean; hiddenTags?: string; hidden?: boolean },
): Promise<IdRun> => {
  const { today, atV } = idSchemas({ hidden });
  const client = input.mode.version ? atV : today;
  const access = idAccessOf(input.mode.access, today);
  const privateHidden = input.mode.access === 'public' || input.mode.access === 'noDraft';
  const opts = {
    hidden,
    tags: hiddenTags,
    retag: (field: 'h' | 'd' | 'u') =>
      field === 'd' || (field === 'u' && input.mode.version) || (field === 'h' && privateHidden),
  };
  const stored: ContentData = {
    ...(input.items.length > 0
      ? { [ITEMS]: input.items.map((item, index) => idStored(item, 'items', index, opts)) }
      : {}),
    ...(input.blocks.length > 0
      ? { [BLOCKS]: input.blocks.map((item, index) => idStored(item, 'blocks', index, opts)) }
      : {}),
  };
  const storedIds = storedWithIds(today, stored);
  const read = access.mayRead
    ? await projectThrough(today, input.mode.version ? atV : null, stored, access.mask, { ids: true })
    : {
        items: writerView(today, client, storedIds, ITEMS, false),
        blocks: writerView(today, client, storedIds, BLOCKS, true),
      };
  const items = idListBody(
    (read.items ?? []) as Array<Record<string, unknown>>,
    input.itemsScript,
    ids,
    false,
    input.mode.version ? ['xw'] : [],
  );
  const blocks = idListBody(
    (read.blocks ?? []) as Array<Record<string, unknown>>,
    input.blocksScript,
    ids,
    true,
    input.mode.version ? ['xw'] : [],
  );
  // Without draft access, a client leaves the fields its version cannot write out of component items (it may
  // not send back what it may not have read: documented).
  const omit = idOmitted(input.mode);
  const body = {
    items: items.sent.map((item) => omitKeys(item, omit)),
    blocks: blocks.sent.map((item) => omitKeys(item, omit)),
  };
  const outcome = deliveryWrite({
    today,
    client: input.mode.version ? atV : null,
    stored,
    body,
    mayRead: access.mayRead,
    seesStored: access.seesStored,
    readable: () => access.mayRead,
    componentReadable: access.componentReadable,
  });
  const message = `mode ${JSON.stringify(input.mode)} ids ${ids}\n  stored ${JSON.stringify(stored)}\n  read ${JSON.stringify(read)}\n  body ${JSON.stringify(body)}\n  outcome ${JSON.stringify({ refusedBy: outcome.refusedBy, issues: outcome.issues, written: outcome.written })}`;
  return {
    outcome,
    storedIds,
    read,
    body,
    origins: { items: items.origins, blocks: blocks.origins },
    message,
  };
};

/** Every hidden-value tag (`xh:items:2`, …) in a value, with the ID of the instance it sits on. */
const tagsByItem = (
  value: unknown,
  owner: string | undefined = undefined,
  into = new Map<string, string>(),
) => {
  if (Array.isArray(value)) {
    value.forEach((item) => tagsByItem(item, owner, into));
  } else if (isObject(value)) {
    const id = typeof value.__id === 'string' ? value.__id : owner;
    for (const [key, item] of Object.entries(value)) {
      if (key !== '__id' && typeof item === 'string' && /^(xh|xd|xu|zh|yh):/.test(item)) {
        into.set(item, id ?? '?');
      } else if (key !== '__id' && typeof item === 'number' && item >= 1000) {
        into.set(`xw:${item}`, id ?? '?');
      } else {
        tagsByItem(item, id, into);
      }
    }
  }
  return into;
};

/** Every `__id` in a value, at any depth. */
const collectIds = (value: unknown, into: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectIds(item, into));
  } else if (isObject(value)) {
    if (typeof value.__id === 'string') {
      into.push(value.__id);
    }
    Object.values(value).forEach((item) => collectIds(item, into));
  }
  return into;
};

/** Hidden (not sent, so carried) tags only: those a body did not carry itself. */
const sentTags = (body: unknown) => tagsByItem(body);

/**
 * Component X as in `pairSchemas`, with `r` (a string at V, removed since), for the sent-back rule: `w` and `t`
 * are read today and still exist (read-only through V), `h` is private, `r` is gone.
 */
const sentBackSchemas = () => {
  const x = (atV: boolean) =>
    componentOf(PAIR_X, 'x', [
      { id: PAIR.v, apiKey: 'v' },
      { id: PAIR.w, apiKey: 'w', type: atV ? 'number' : 'integer' },
      { id: PAIR.t, apiKey: 't', type: atV ? 'string' : 'text' },
      { id: PAIR.h, apiKey: 'h', public: false },
      ...(atV ? [{ id: F(0x66), apiKey: 'r' }] : []),
    ]);
  const model = pageOf([
    { id: ITEMS, apiKey: 'items', type: 'component', settings: { component: PAIR_X, repeatable: true } },
  ]);
  return { today: schemaOf(model, [x(false)]), atV: schemaOf(model, [x(true)]) };
};

type SentBackPick = {
  /** A read item to start from (its index), or a fresh one. */
  from: number | undefined;
  v: string | undefined;
  w: number | undefined;
  t: string | undefined;
  r: boolean;
  h: boolean;
};

/** True about one time in eight. */
const rarely = fc.oneof(
  { arbitrary: fc.constant(false), weight: 7 },
  { arbitrary: fc.constant(true), weight: 1 },
);

const sentBackCaseArb = fc.record({
  stored: fc.array(
    fc.record({
      kind: fc.constant<'x' | 'y'>('x'),
      v: fc.constantFrom('p', 'q'),
      w: fc.boolean(),
      t: fc.boolean(),
      h: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  sent: fc.array(
    fc.record({
      from: fc.option(fc.nat({ max: 3 }), { nil: undefined, freq: 4 }),
      v: fc.option(fc.constantFrom('p', 'q', 'e'), { nil: undefined, freq: 2 }),
      // Mostly as read (left alone), sometimes another stored item's value or a new one.
      w: fc.option(fc.constantFrom(100, 101, 102, 999), { nil: undefined, freq: 3 }),
      t: fc.option(fc.constantFrom('t0', 't1', 't2', 'tx'), { nil: undefined, freq: 3 }),
      r: rarely,
      h: rarely,
    }),
    { maxLength: 4 },
  ),
});

const sentBackItem = (read: ReadonlyArray<Record<string, unknown>>, pick: SentBackPick) => {
  const base = pick.from !== undefined ? read[pick.from] : undefined;
  const item: Record<string, unknown> = base
    ? Object.fromEntries(Object.entries(base).filter(([, value]) => value !== null))
    : { v: 'n' };
  if (pick.v !== undefined) {
    item.v = pick.v;
  }
  if (pick.w !== undefined) {
    item.w = pick.w;
  }
  if (pick.t !== undefined) {
    item.t = pick.t;
  }
  if (pick.r) {
    item.r = 'rv';
  }
  if (pick.h) {
    item.h = 'hv';
  }
  return item;
};

describe('item IDs: properties', { timeout: 900_000 }, () => {
  it('ID1. with IDs echoed, any edit through any version and visibility is accepted, reads back as sent, and every hidden value stays on its item', async () => {
    await fc.assert(
      fc.asyncProperty(idCaseArb(), async (input) => {
        const run = await runIdCase(input, { ids: true });
        const { outcome, storedIds, body, message } = run;
        expect(outcome.refusedBy, message).toBeNull();
        const written = outcome.written as ContentData;
        const problems: string[] = [];
        // Every stored hidden value is on the item whose ID it had, or gone with a deleted item; nothing else.
        const before = tagsByItem(storedIds);
        const after = tagsByItem(written);
        const sent = sentTags(body);
        for (const [tag, id] of after) {
          if (sent.has(tag)) {
            continue;
          }
          if (before.get(tag) !== id) {
            problems.push(`${tag}: stored on ${before.get(tag) ?? 'nothing'}, now on ${id}`);
          }
        }
        // A surviving item keeps every value it held that the caller did not send (it could not see it, or
        // its version cannot write it). An update-only caller sends back every value it may write.
        const survivors = new Set(collectIds(written));
        for (const [tag, id] of before) {
          if (survivors.has(id) && !after.has(tag) && !sent.has(tag)) {
            problems.push(`${tag}: its item ${id} survived, the value did not`);
          }
        }
        // Reads back as sent, item by item, in order, with the IDs it sent.
        if (input.mode.access !== 'updateOnly') {
          const access = idAccessOf(input.mode.access, idSchemas().today);
          const back = await projectThrough(
            idSchemas().today,
            input.mode.version ? idSchemas().atV : null,
            written,
            access.mask,
            { ids: true },
          );
          for (const name of ['items', 'blocks'] as const) {
            const got = (back[name] ?? []) as Array<Record<string, unknown>>;
            const want = body[name];
            if (got.length !== want.length) {
              problems.push(`${name}: ${got.length} items read back for ${want.length} sent`);
              continue;
            }
            want.forEach((item, index) => {
              const echoed = got[index] ?? {};
              if (typeof item.id === 'string' && echoed.id !== item.id) {
                problems.push(`${name}#${index}: sent id ${String(item.id)}, read back ${String(echoed.id)}`);
              }
              const strip = (value: unknown): unknown =>
                Array.isArray(value)
                  ? value.map(strip)
                  : isObject(value)
                    ? Object.fromEntries(
                        Object.entries(value)
                          .filter(([key, v]) => key !== 'id' && !isEmptyApiValue(v))
                          .map(([key, v]) => [key, strip(v)]),
                      )
                    : value;
              if (!same(strip(omitKeys(echoed, idOmitted(input.mode))), strip(item))) {
                problems.push(
                  `${name}#${index}: read back ${JSON.stringify(strip(echoed))} ≠ sent ${JSON.stringify(strip(item))}`,
                );
              }
            });
          }
        }
        expect(problems, message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});

/** An item's visible part as its caller reads it (an `id`-free, empty-free canonical form), for comparing. */
const callerView = (item: unknown): string => {
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(strip)
      : isObject(value)
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key, v]) => key !== 'id' && !isEmptyApiValue(v))
              .map(([key, v]) => [key, strip(v)]),
          )
        : value;
  return canonicalJson(strip(item));
};

/** Per written item of a list, the index of the stored item it continues (by `__id`), or -1 for a new one. */
const continuedIndexes = (storedIds: ContentData, written: ContentData, fieldId: string): number[] => {
  const storedList = (storedIds[fieldId] ?? []) as Array<Record<string, unknown>>;
  const index = new Map(storedList.map((item, position) => [item.__id, position]));
  return ((written[fieldId] ?? []) as Array<Record<string, unknown>>).map(
    (item) => index.get(item.__id) ?? -1,
  );
};

/**
 * The strict no-ID rule (plan item-ids, `alignItemsStrictly`) for one list that can hold values its caller cannot
 * see, from what the caller sees of each item: the views it sent and read, and each item's component.
 */
type StrictList = { sent: string[]; stored: string[]; sentKinds: unknown[]; storedKinds: unknown[] };

const countsOf = (views: readonly string[]) => {
  const counts = new Map<string, number>();
  views.forEach((view) => counts.set(view, (counts.get(view) ?? 0) + 1));
  return counts;
};

/**
 * A pure edit in place: the list kept its length, every place holds the same component, no item that changed at
 * its place had its old content sent at another place, and the list is not a rearrangement of the stored items.
 * Identity counts too.
 */
const strictInPlace = (list: StrictList): boolean => {
  const { sent, stored } = list;
  if (sent.length !== stored.length) {
    return false;
  }
  if (sent.every((view, index) => view === stored[index])) {
    return true;
  }
  if (!list.sentKinds.every((kind, index) => kind === list.storedKinds[index])) {
    return false;
  }
  const sentCounts = countsOf(sent);
  if (stored.some((view, index) => view !== sent[index] && sentCounts.has(view))) {
    return false;
  }
  const storedCounts = countsOf(stored);
  const rearranged =
    sentCounts.size === storedCounts.size &&
    [...sentCounts].every(([view, count]) => storedCounts.get(view) === count);
  return !rearranged;
};

/**
 * What an accepted no-ID write of one such list may do under the strict rule, from per sent item the stored item
 * it continues (-1: new):
 * - carry: an item continues a stored item only when the caller sees them equal, or in a pure edit in place at
 *   the same place (so a hidden value never sits on any other item);
 * - certain: an item that is the only one of its view in both lists continues that stored item;
 * - gaps: no new item and deleted stored item share a gap (no continued pair stands between them in both lists).
 */
const strictListProblems = (
  name: string,
  list: StrictList,
  continued: readonly number[],
  checks: { carry?: boolean; certain?: boolean; gaps?: boolean } = { carry: true, certain: true, gaps: true },
): string[] => {
  const problems: string[] = [];
  const inPlace = strictInPlace(list);
  if (checks.carry) {
    continued.forEach((storedAt, sentAt) => {
      if (
        storedAt !== -1 &&
        list.sent[sentAt] !== list.stored[storedAt] &&
        !(inPlace && storedAt === sentAt)
      ) {
        problems.push(
          `${name}#${sentAt} continues stored ${storedAt} (${list.stored[storedAt]}) but was sent as ${list.sent[sentAt]}${inPlace ? ', not at its place' : ', not an edit in place'}`,
        );
      }
    });
  }
  if (checks.certain) {
    const sentCounts = countsOf(list.sent);
    const storedCounts = countsOf(list.stored);
    list.sent.forEach((view, sentAt) => {
      if (sentCounts.get(view) === 1 && storedCounts.get(view) === 1) {
        const storedAt = list.stored.indexOf(view);
        if (continued[sentAt] !== storedAt) {
          problems.push(
            `${name}#${sentAt}: the only ${view} in both lists continues ${continued[sentAt] ?? -1}, not stored ${storedAt}`,
          );
        }
      }
    });
  }
  if (checks.gaps) {
    const pairs = continued.flatMap((storedAt, sentAt) =>
      storedAt === -1 ? [] : [[sentAt, storedAt] as const],
    );
    const kept = new Set(continued);
    const deleted = list.stored.flatMap((_, storedAt) => (kept.has(storedAt) ? [] : [storedAt]));
    continued.forEach((storedAt, sentAt) => {
      if (storedAt !== -1) {
        return;
      }
      for (const gone of deleted) {
        const apart = pairs.some(
          ([pairSent, pairStored]) =>
            (pairSent < sentAt && pairStored > gone) || (pairSent > sentAt && pairStored < gone),
        );
        if (!apart) {
          problems.push(
            `${name}: new #${sentAt} and deleted stored ${gone} share a gap, yet the list was accepted`,
          );
          return;
        }
      }
    });
  }
  return problems;
};

/** The strict list of a sent and a read list (API form; a zone's items name their component). */
const strictListOf = (sent: readonly unknown[], read: readonly unknown[]): StrictList => ({
  sent: sent.map(callerView),
  stored: read.map(callerView),
  sentKinds: sent.map((item) => (isObject(item) ? (item[COMPONENT_KEY] ?? null) : null)),
  storedKinds: read.map((item) => (isObject(item) ? (item[COMPONENT_KEY] ?? null) : null)),
});

/** Whether an issue path names a list itself (`/items`, `/blocks`, `/items/0/sub`), not a value under it. */
const isListPath = (path: string): boolean => /^\/(items|blocks)(\/\d+\/sub)?$/.test(path);

/**
 * A no-ID refusal the strict rule explains, for bodies that only send back read-only values as read: the lists
 * answer AMBIGUOUS_ITEMS at the list and nothing else. A "send back the value it read" NOT_ALLOWED on an item that
 * is no exact-match continuation (made new, or edited at its place) is answered that way too (X2, AB), so no
 * NOT_ALLOWED and no other version issue under a list ever shows.
 */
const strictRefusalProblems = (issues: readonly ContentIssue[]): string[] =>
  issues.length > 0 && issues.every((issue) => issue.code === 'AMBIGUOUS_ITEMS' && isListPath(issue.path))
    ? []
    : issues
        .filter((issue) => !(issue.code === 'AMBIGUOUS_ITEMS' && isListPath(issue.path)))
        .map((issue) => `refused: ${issue.code} ${issue.path}`)
        .concat(issues.length === 0 ? ['refused without an issue'] : []);

/**
 * Every list of an accepted no-ID ID-model write checked against the strict rule: `items` and `blocks` (they
 * hold a deprecated or private field for every caller), and each continued X item's `sub` when its private `zh`
 * is hidden from the caller (otherwise `sub` holds nothing hidden and keeps the least-edit alignment).
 */
const strictProblems = (
  run: IdRun,
  mode: IdMode,
  checks?: { carry?: boolean; certain?: boolean; gaps?: boolean },
): string[] => {
  const written = run.outcome.written as ContentData;
  const subHidden = mode.access === 'public' || mode.access === 'noDraft';
  const problems: string[] = [];
  for (const [name, fieldId] of [
    ['items', ITEMS],
    ['blocks', BLOCKS],
  ] as const) {
    const read = (run.read[name] ?? []) as unknown[];
    const sent = run.body[name];
    const continued = continuedIndexes(run.storedIds, written, fieldId);
    problems.push(...strictListProblems(name, strictListOf(sent, read), continued, checks));
    if (!subHidden) {
      continue;
    }
    const storedList = (run.storedIds[fieldId] ?? []) as Array<Record<string, unknown>>;
    const writtenList = (written[fieldId] ?? []) as Array<Record<string, unknown>>;
    continued.forEach((storedAt, sentAt) => {
      const readItem = read[storedAt];
      const sentItem = sent[sentAt];
      if (storedAt === -1 || !isObject(readItem) || !isObject(sentItem) || !Array.isArray(sentItem.sub)) {
        return;
      }
      const subContinued = continuedIndexes(
        { [IDF.sub]: storedList[storedAt]?.[IDF.sub] ?? [] },
        { [IDF.sub]: writtenList[sentAt]?.[IDF.sub] ?? [] },
        IDF.sub,
      );
      problems.push(
        ...strictListProblems(
          `${name}#${sentAt}.sub`,
          strictListOf(sentItem.sub as unknown[], (readItem.sub ?? []) as unknown[]),
          subContinued,
          checks,
        ),
      );
    });
  }
  return problems;
};

/** `item` with the hidden values of `access` drawn again (presence and value), the visible part unchanged. */
const redrawHidden = (item: IdItem, mode: IdMode, flips: readonly boolean[]): IdItem => {
  const flip = (index: number, value: boolean) => (flips[index % flips.length] ? !value : value);
  const privateHidden = mode.access === 'public' || mode.access === 'noDraft';
  return {
    ...item,
    // Deprecated: hidden from everyone. Private: hidden from public callers. Added since V: unknown through V.
    d: flip(0, item.d),
    h: privateHidden ? flip(1, item.h) : item.h,
    u: mode.version ? flip(2, item.u) : item.u,
    sub: item.sub.map((sub, position) => ({ ...sub, h: privateHidden ? flip(3 + position, sub.h) : sub.h })),
  };
};

describe('item IDs: no-ID safety, no oracle, derived IDs', { timeout: 900_000 }, () => {
  it('ID2. without IDs, a write is refused or follows the strict rule: values stay on their IDs, equal items or a pure edit in place only', async () => {
    await fc.assert(
      fc.asyncProperty(idCaseArb(), async (input) => {
        const run = await runIdCase(input, { ids: false });
        if (run.outcome.refusedBy !== null) {
          expect(strictRefusalProblems(run.outcome.issues), run.message).toEqual([]);
          return;
        }
        const written = run.outcome.written as ContentData;
        const problems: string[] = [];
        // Values follow the ID they were stored under.
        const before = tagsByItem(run.storedIds);
        const sent = sentTags(run.body);
        for (const [tag, id] of tagsByItem(written)) {
          if (!sent.has(tag) && before.get(tag) !== id) {
            problems.push(`${tag}: stored on ${before.get(tag) ?? 'nothing'}, now on ${id}`);
          }
        }
        problems.push(...strictProblems(run, input.mode));
        expect(problems, run.message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('ID3. no oracle: with what the caller sees fixed, hidden values never change accept or refuse, nor which items continue', async () => {
    await fc.assert(
      fc.asyncProperty(
        idCaseArb().chain((input) =>
          fc.tuple(fc.constant(input), fc.array(fc.boolean(), { minLength: 8, maxLength: 8 })),
        ),
        async ([input, flips]) => {
          const a = await runIdCase(input, { ids: false });
          const redrawn: IdCase = {
            ...input,
            items: input.items.map((item) => redrawHidden(item, input.mode, flips)),
            blocks: input.blocks.map((item) => redrawHidden(item, input.mode, flips)),
          };
          const b = await runIdCase(redrawn, { ids: false, hiddenTags: ':redrawn' });
          const message = `A\n${a.message}\nB\n${b.message}`;
          // Precondition: the caller saw the same thing both times (else the case says nothing).
          if (callerView(a.read) !== callerView(b.read)) {
            return;
          }
          const outcomeOf = (run: IdRun) => ({
            refusedBy: run.outcome.refusedBy,
            issues: run.outcome.issues.map((issue) => `${issue.code} ${issue.path}`),
            items: run.outcome.written ? continuedIndexes(run.storedIds, run.outcome.written, ITEMS) : null,
            blocks: run.outcome.written ? continuedIndexes(run.storedIds, run.outcome.written, BLOCKS) : null,
          });
          expect(outcomeOf(b), message).toEqual(outcomeOf(a));
        },
      ),
      { numRuns: RUNS },
    );
  });

  /** Modes a no-ID write can be accepted in (update-only and no-draft callers cannot see what they replace). */
  const seeingModes = ID_MODES.filter((mode) => mode.access === 'public' || mode.access === 'all');

  it('NI1. without IDs, an accepted write leaves a hidden value only on its own item, sent as the caller saw it or edited where it stood', async () => {
    await fc.assert(
      fc.asyncProperty(idCaseArb(seeingModes), async (input) => {
        const run = await runIdCase(input, { ids: false });
        if (run.outcome.refusedBy !== null) {
          expect(strictRefusalProblems(run.outcome.issues), run.message).toEqual([]);
          return;
        }
        const written = run.outcome.written as ContentData;
        const before = tagsByItem(run.storedIds);
        const sent = sentTags(run.body);
        const problems: string[] = [];
        const holders = new Set<string>();
        for (const [tag, id] of tagsByItem(written)) {
          if (sent.has(tag)) {
            continue;
          }
          holders.add(id);
          if (before.get(tag) !== id) {
            problems.push(`${tag}: stored on ${before.get(tag) ?? 'nothing'}, now on ${id}`);
          }
        }
        // Every item that holds a hidden value continues a stored item it equals, or stands where it stood in a
        // pure edit in place.
        problems.push(...strictProblems(run, input.mode, { carry: true }));
        expect(problems, run.message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('NI2. without IDs, a list with a gap holding both new items and leftover stored items is refused', async () => {
    await fc.assert(
      fc.asyncProperty(idCaseArb(seeingModes), async (input) => {
        const run = await runIdCase(input, { ids: false });
        if (run.outcome.refusedBy !== null) {
          expect(strictRefusalProblems(run.outcome.issues), run.message).toEqual([]);
          return;
        }
        expect(strictProblems(run, input.mode, { gaps: true }), run.message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('NI3. without IDs, a "send back the value it read" refusal never lands on an item that is no exact-match continuation: the list answers AMBIGUOUS_ITEMS', async () => {
    const { today, atV } = sentBackSchemas();
    const all = fieldsById(today);
    const componentReadable = (fieldId: string) => {
      const field = all.get(fieldId)?.field;
      return field !== undefined && field.public && !field.deprecated;
    };
    await fc.assert(
      fc.asyncProperty(sentBackCaseArb, async ({ stored: specs, sent: picks }) => {
        const stored: ContentData =
          specs.length > 0 ? { [ITEMS]: specs.map((item, index) => pairStored(item, index, false)) } : {};
        const read = (await projectThrough(today, atV, stored, deliveryMask(today), { ids: false })).items as
          Array<Record<string, unknown>> | undefined;
        const items = picks.map((pick) => sentBackItem(read ?? [], pick));
        const outcome = deliveryWrite({
          today,
          client: atV,
          stored,
          body: { items },
          mayRead: true,
          readable: () => true,
          componentReadable,
        });
        const message = `stored ${JSON.stringify(stored)}\n  read ${JSON.stringify(read)}\n  body ${JSON.stringify({ items })}\n  outcome ${JSON.stringify({ refusedBy: outcome.refusedBy, issues: outcome.issues, written: outcome.written })}`;
        const problems: string[] = [];
        // A value the caller reads today and that still exists (w, t), sent on an item: refused as NOT_ALLOWED
        // only on an exact-match continuation, which sends it back as read, so never.
        for (const issue of outcome.issues) {
          if (issue.code === 'NOT_ALLOWED' && /^\/items\/\d+\/(w|t)$/.test(issue.path)) {
            problems.push(`NOT_ALLOWED ${issue.path}: ${issue.message}`);
          }
          if (issue.code === 'AMBIGUOUS_ITEMS' && issue.path !== '/items') {
            problems.push(`AMBIGUOUS_ITEMS at ${issue.path}`);
          }
        }
        // A sent w or t that no stored item holds (a change, or a value on a new item) cannot continue anything
        // exactly: the write is refused, at the list (or for its own removed or unreadable field).
        const changed = items.some((item) =>
          (['w', 't'] as const).some(
            (key) =>
              item[key] !== undefined && !(read ?? []).some((candidate) => candidate[key] === item[key]),
          ),
        );
        const ownAnswer = outcome.issues.some((issue) => /^\/items\/\d+\/(r|h)$/.test(issue.path));
        if (
          changed &&
          !ownAnswer &&
          !outcome.issues.some((issue) => issue.code === 'AMBIGUOUS_ITEMS' && issue.path === '/items')
        ) {
          problems.push(`a changed read-only value was not answered AMBIGUOUS_ITEMS (${outcome.refusedBy})`);
        }
        expect(problems, message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('ID4. derived IDs: the same for an unchanged item at any position, distinct for different or repeated items', () => {
    const { today } = idSchemas();
    fc.assert(
      fc.property(
        fc.array(idItemArb(false), { minLength: 1, maxLength: 6 }),
        fc.array(fc.nat(), { maxLength: 6 }),
        fc.array(fc.option(fc.constantFrom('p', 'q', 'r'), { nil: undefined }), { maxLength: 6 }),
        (items, order, edits) => {
          const legacy = items.map((item) => ({ ...item, legacy: true }));
          const draft = legacy.map((item, index) =>
            idStored(item, 'items', index, { hidden: true, tags: '' }),
          );
          // The published version: the same items in another order, some edited.
          const permuted = draft
            .map((item, index) => ({ item, key: order[index] ?? index }))
            .sort((x, y) => x.key - y.key)
            .map(({ item }, index) =>
              edits[index] === undefined
                ? item
                : { ...item, [IDF.xv]: `${String(item[IDF.xv])}-${edits[index]}` },
            );
          const idsOf = (list: Array<Record<string, unknown>>) =>
            ((storedWithIds(today, { [ITEMS]: list })[ITEMS] ?? []) as Array<Record<string, unknown>>).map(
              (item) => ({
                id: String(item.__id),
                content: canonicalJson(withoutStoredItemIds(item)),
                subIds: ((item[IDF.sub] ?? []) as Array<Record<string, unknown>>).map((sub) =>
                  String(sub.__id),
                ),
              }),
            );
          const a = idsOf(draft);
          const b = idsOf(permuted);
          const problems: string[] = [];
          for (const side of [a, b]) {
            if (new Set(side.map((entry) => entry.id)).size !== side.length) {
              problems.push('two items of one list share an ID');
            }
          }
          const group = (side: typeof a) => {
            const groups = new Map<string, string[]>();
            side.forEach((entry) =>
              groups.set(entry.content, [...(groups.get(entry.content) ?? []), entry.id]),
            );
            return groups;
          };
          const [ga, gb] = [group(a), group(b)];
          for (const [content, ids] of ga) {
            const other = gb.get(content);
            if (
              other &&
              other.length === ids.length &&
              canonicalJson([...ids].sort()) !== canonicalJson([...other].sort())
            ) {
              problems.push(
                `unchanged content ${content.slice(0, 60)}: IDs ${ids.join(',')} vs ${other.join(',')}`,
              );
            }
          }
          const contentById = new Map<string, string>();
          for (const entry of [...a, ...b]) {
            const known = contentById.get(entry.id);
            if (known !== undefined && known !== entry.content) {
              problems.push(`ID ${entry.id} names two different items`);
            }
            contentById.set(entry.id, entry.content);
          }
          // An unchanged parent's nested items keep their IDs too.
          for (const entry of a) {
            const twin =
              (gb.get(entry.content)?.length ?? 0) === 1 && (ga.get(entry.content)?.length ?? 0) === 1
                ? b.find((other) => other.content === entry.content)
                : undefined;
            if (twin && canonicalJson(twin.subIds) !== canonicalJson(entry.subIds)) {
              problems.push(
                `nested IDs of an unchanged item moved: ${entry.subIds.join(',')} vs ${twin.subIds.join(',')}`,
              );
            }
          }
          expect(problems, JSON.stringify({ draft, permuted })).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('ID5. a caller for whom a list holds nothing hidden is never refused for ambiguity, whatever it sends', async () => {
    const modes: IdMode[] = [false, true].flatMap((version) =>
      (['public', 'all'] as const).map((access) => ({ version, access })),
    );
    await fc.assert(
      fc.asyncProperty(idCaseArb(modes), fc.boolean(), async (input, ids) => {
        const run = await runIdCase(input, { ids, hidden: false });
        expect(
          run.outcome.issues.filter((issue) => issue.code === 'AMBIGUOUS_ITEMS'),
          run.message,
        ).toEqual([]);
        expect(run.outcome.refusedBy, run.message).toBeNull();
      }),
      { numRuns: RUNS },
    );
  });
});

describe('item IDs: recorded trade-offs', () => {
  it('P with IDs: a new item sent with `id: null` where another stood carries nothing; the replaced item is deleted', () => {
    // P stays a documented trade-off without IDs (the in-place substitution); with IDs it is certain.
    const { today } = idSchemas();
    const access = idAccessOf('public', today);
    const stored = { [ITEMS]: [{ __id: F(0xa1), [IDF.xv]: 'p', [IDF.xh]: 'h' }] };
    const write = (items: unknown[]) =>
      deliveryWrite({
        today,
        client: null,
        stored,
        body: { items },
        mayRead: true,
        readable: () => true,
        componentReadable: access.componentReadable,
      });
    const withIds = write([{ id: null, xv: 'new' }]);
    const item = (withIds.written?.[ITEMS] as Array<Record<string, unknown>>)[0] ?? {};
    expect(item[IDF.xh]).toBeUndefined();
    expect(item.__id).not.toBe(F(0xa1));
    // Without IDs: the substitution (documented), the private value carried.
    const noIds = write([{ xv: 'new' }]);
    expect((noIds.written?.[ITEMS] as Array<Record<string, unknown>>)[0]?.[IDF.xh]).toBe('h');
  });

  it('W with IDs: move-and-edit plus an append keeps each private value with its item', () => {
    const { today } = idSchemas();
    const access = idAccessOf('public', today);
    const stored = {
      [ITEMS]: [
        { __id: F(0xa1), [IDF.xv]: 'p' },
        { __id: F(0xb2), [IDF.xv]: 'q', [IDF.xh]: 'B-private' },
      ],
    };
    const outcome = deliveryWrite({
      today,
      client: null,
      stored,
      body: {
        items: [
          { id: F(0xb2), xv: 'q2' },
          { id: F(0xa1), xv: 'p' },
          { id: null, xv: 'n' },
        ],
      },
      mayRead: true,
      readable: () => true,
      componentReadable: access.componentReadable,
    });
    const written = (outcome.written?.[ITEMS] ?? []) as Array<Record<string, unknown>>;
    expect(written.map((item) => item[IDF.xh])).toEqual(['B-private', undefined, undefined]);
  });

  it('W. without IDs, move-and-edit plus an append is refused (AMBIGUOUS_ITEMS): nothing is guessed', () => {
    // ID2, seed -686163899, minimized; a counterexample before the strict alignment. Stored [A{xv:p},
    // B{xv:q, xh:'B-private'}] (xh private); the client moves B to the front and edits it, and appends a new item,
    // all without IDs: [{xv:q2}, {xv:p}, {xv:n}]. A is the unique anchor; after it, stored B faces sent n, a gap
    // with leftovers on both sides: refused. (Before: n continued B and held B-private.) With IDs: exact (above).
    const { today } = idSchemas();
    const access = idAccessOf('public', today);
    const stored = {
      [ITEMS]: [
        { __id: F(0xa1), [IDF.xv]: 'p' },
        { __id: F(0xb2), [IDF.xv]: 'q', [IDF.xh]: 'B-private' },
      ],
    };
    const outcome = deliveryWrite({
      today,
      client: null,
      stored,
      body: { items: [{ xv: 'q2' }, { xv: 'p' }, { xv: 'n' }] },
      mayRead: true,
      readable: () => true,
      componentReadable: access.componentReadable,
    });
    expect(outcome.refusedBy).toBe('items');
    expect(outcome.issues.map((issue) => issue.code)).toEqual(['AMBIGUOUS_ITEMS']);
    expect(outcome.written).toBeNull();
  });
});
describe('item IDs: counterexamples', () => {
  it('X. through a version, an ambiguous list is refused with AMBIGUOUS_ITEMS only, no version issue under it', () => {
    // Property 14, seed -1196616743, minimized; a counterexample before the strict alignment (the client got 422
    // NOT_ALLOWED "send back the value it read" on t0, which it did). Stored [{v:'p', t:'t0'}, {v:'p'}] (t: string
    // at V, text today, so read-only through V). Sent without IDs: [{v:'p', t:'t0'}, {v:'n'}, {v:'n'}].
    const stored = {
      [ITEMS]: [
        pairStored({ kind: 'x', v: 'p', w: false, t: true, h: false }, 0, false),
        pairStored({ kind: 'x', v: 'p', w: false, t: false, h: false }, 1, false),
      ],
    };
    const outcome = writePairs('lensRead', stored, {
      items: [{ v: 'p', t: 't0' }, { v: 'n' }, { v: 'n' }],
      blocks: [],
    });
    expect(outcome.issues.map((issue) => [issue.code, issue.path])).toEqual([['AMBIGUOUS_ITEMS', '/items']]);
    expect(outcome.written).toBeNull();
  });

  it('X2. through a version, every item edited where it stands, one into a copy of another: AMBIGUOUS_ITEMS, nothing written', () => {
    // Property 14, seed 2118657728, minimized. Stored [{v:'p'}, {v:'q', w:101, t:'t1'}, {v:'q'}] (w, t read-only
    // through V). Sent without IDs: [{v:'e'}, {v:'p', w:101, t:'t1'}, {v:'p'}]. Not an edit in place (the stored
    // first's content is sent at another place); exact matches only: the sent third continues the stored first
    // (a move), the others are new. The second sends read-only values back as read on an item the alignment made
    // new: before the fix, NOT_ALLOWED on /items/1/w and /items/1/t; now the list answers AMBIGUOUS_ITEMS only.
    const stored = {
      [ITEMS]: [
        pairStored({ kind: 'x', v: 'p', w: false, t: false, h: false }, 0, false),
        pairStored({ kind: 'x', v: 'q', w: true, t: true, h: false }, 1, false),
        pairStored({ kind: 'x', v: 'q', w: false, t: false, h: false }, 2, false),
      ],
    };
    const outcome = writePairs('lensRead', stored, {
      items: [{ v: 'e' }, { v: 'p', w: 101, t: 't1' }, { v: 'p' }],
      blocks: [],
    });
    expect(outcome.issues.map((issue) => [issue.code, issue.path])).toEqual([['AMBIGUOUS_ITEMS', '/items']]);
    expect(outcome.written).toBeNull();
  });

  it('Y. without IDs, every item edited where it stands, one into a copy of another: a move, nothing else carried', () => {
    // Found while minimizing X2. Stored [A{xv:p, xh:A-private}, B{xv:q, xh:B-private}, C{xv:q, xh:C-private}]
    // (xh private); a public caller sends without IDs [{xv:e}, {xv:p, xu:b}, {xv:p}]. An old value sent at another
    // place is a move (decision 2026-11-11): the sent {xv:p} continues A and keeps A-private; B and C are deleted
    // with their values; the new items carry nothing; no private value sits on another item.
    const { today } = idSchemas();
    const access = idAccessOf('public', today);
    const stored = {
      [ITEMS]: [
        { __id: F(0xa1), [IDF.xv]: 'p', [IDF.xh]: 'A-private' },
        { __id: F(0xa2), [IDF.xv]: 'q', [IDF.xh]: 'B-private' },
        { __id: F(0xa3), [IDF.xv]: 'q', [IDF.xh]: 'C-private' },
      ],
    };
    const outcome = deliveryWrite({
      today,
      client: null,
      stored,
      body: { items: [{ xv: 'e' }, { xv: 'p', xu: 'b' }, { xv: 'p' }] },
      mayRead: true,
      readable: () => true,
      componentReadable: access.componentReadable,
    });
    expect(outcome.refusedBy).toBeNull();
    const written = (outcome.written?.[ITEMS] ?? []) as Array<Record<string, unknown>>;
    expect(written.map((item) => [item[IDF.xv], item[IDF.xh]])).toEqual([
      ['e', undefined],
      ['p', undefined],
      ['p', 'A-private'],
    ]);
    expect(written[2]?.__id).toBe(F(0xa1));
    expect(written.slice(0, 2).map((item) => item.__id)).not.toContain(F(0xa2));
    expect(written.slice(0, 2).map((item) => item.__id)).not.toContain(F(0xa3));
  });

  it('AB. through a version, items swapped and both edited: AMBIGUOUS_ITEMS without IDs; with IDs each w stays with its item', async () => {
    // ID2, seed -311968420, minimized. Stored [{v:'p', w:100}, {v:'q', w:101}] (w: number at V, integer today,
    // so read-only through V). The client swaps them and edits both, sending each w back as read:
    // [{v:'q2', w:101}, {v:'p2', w:100}]. Without IDs it reads as a pure edit in place (no sent item equals a
    // stored one), so each w reads as a change: before the fix, NOT_ALLOWED "send back the value it read" on both
    // (which it did, at the other place); now the list answers AMBIGUOUS_ITEMS only.
    const stored = {
      [ITEMS]: [
        pairStored({ kind: 'x', v: 'p', w: true, t: false, h: false }, 0, false),
        pairStored({ kind: 'x', v: 'q', w: true, t: false, h: false }, 1, false),
      ],
    };
    const noIds = writePairs('lensRead', stored, {
      items: [
        { v: 'q2', w: 101 },
        { v: 'p2', w: 100 },
      ],
      blocks: [],
    });
    expect(noIds.issues.map((issue) => [issue.code, issue.path])).toEqual([['AMBIGUOUS_ITEMS', '/items']]);
    expect(noIds.written).toBeNull();
    const { today, atV } = pairSchemas();
    const read = await projectThrough(today, atV, stored, deliveryMask(today), { ids: true });
    const [first, second] = read.items as Array<Record<string, unknown>>;
    const withIds = writePairs('lensRead', stored, {
      items: [
        { id: second?.id, v: 'q2', w: 101 },
        { id: first?.id, v: 'p2', w: 100 },
      ],
      blocks: [],
    });
    expect(withIds.issues).toEqual([]);
    expect(withIds.written?.[ITEMS]).toEqual([
      { [PAIR.v]: 'q2', [PAIR.w]: 101 },
      { [PAIR.v]: 'p2', [PAIR.w]: 100 },
    ]);
  });

  it('seed 742367977: [p, q, q] sent as [q, p, p, p] without IDs is refused (AMBIGUOUS_ITEMS)', () => {
    // ID2, a counterexample before the strict alignment: the only q echo was new, while both stored q items'
    // private values went to items sent as p (edits in place). Now: not an edit in place (length changed), and
    // exact matches leave stored and sent leftovers in one gap: refused.
    const { today } = idSchemas();
    const access = idAccessOf('public', today);
    const stored = {
      [BLOCKS]: [
        { __id: F(0xc0), __component: ID_Y, [IDF.yv]: 'p', [IDF.yh]: 'h0' },
        { __id: F(0xc1), __component: ID_Y, [IDF.yv]: 'q', [IDF.yh]: 'h1' },
        { __id: F(0xc2), __component: ID_Y, [IDF.yv]: 'q', [IDF.yh]: 'h2' },
      ],
    };
    const y = (yv: string) => ({ __component: 'y', yv });
    const outcome = deliveryWrite({
      today,
      client: null,
      stored,
      body: { blocks: [y('q'), y('p'), y('p'), y('p')] },
      mayRead: true,
      readable: () => true,
      componentReadable: access.componentReadable,
    });
    expect(outcome.issues.map((issue) => issue.code)).toEqual(['AMBIGUOUS_ITEMS']);
    expect(outcome.written).toBeNull();
  });
});
