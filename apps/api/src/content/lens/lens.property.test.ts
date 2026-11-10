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
import { instanceIssues, isEmptyApiValue, walkDelivered } from '../../../test/helpers/lensOracles.js';
import type { ContentData } from '../../db/contentData.js';
import { AppError } from '../../helpers/appError.js';
import type { FieldMask, Policy } from '../../permissions/types.js';
import type { HeadRow } from '../compiler/compile.js';
import { maskAllows } from '../compiler/policy.js';
import type { QueryTree } from '../compiler/querystring.js';
import { projectRows, type ReadEnvironment } from '../read.js';
import { COMPONENT_KEY } from '../validator/index.js';
import { canonicalDate, canonicalDatetime, canonicalTime } from '../validator/scalars.js';
import { keepUnreadableComponentFields } from '../write/keepUnreadable.js';
import { rewriteQueryTree } from './query.js';
import { readThroughLens } from './read.js';
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

/** What a client on `client` reads of `data` stored under `today`, through the real lensed projection. */
const projectThrough = async (
  today: Schema,
  client: Schema | null,
  data: ContentData,
  mask: FieldMask = ALL,
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
  return projected?.data ?? {};
};

const componentsOf = (schema: Schema) => (id: string) => componentById(schema, id);

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
        const projected = await projectThrough(today, client, todayData);
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
        const projected = await projectThrough(last(history.versions), start, last(history.data));
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
            const projected = await projectThrough(today, start, data);
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
          instanceIssues(client.model, directOut, componentsOf(client), ''),
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
  const componentFieldReadable = (fieldId: string) => {
    const field = todayFields.get(fieldId)?.field;
    return field !== undefined && !field.deprecated && (field.public || !publicOnly);
  };
  const read = readableThroughLens(lens, readThroughLens(lens, stored), readable, componentFieldReadable);
  const result = writeThroughLens(lens, input, {
    stored,
    reads: [read],
    definitionOf: definitionOfToday(today),
    readable,
    componentFieldReadable,
  });
  if (result.issues.length > 0) {
    return { lens, result, written: null, refusedBy: 'lens' as const };
  }
  const validator = validatorOf(today);
  const { patch, issues } = validator.fromInput(result.input);
  if (issues.length > 0) {
    return { lens, result, written: null, refusedBy: 'fromInput' as const, issues };
  }
  // `assertWritable`: every patched field must be in the write mask (403 FORBIDDEN_FIELD otherwise).
  const denied = today.model.fields.filter((field) => field.id in patch && !maskAllows(writeMask, field));
  if (denied.length > 0) {
    return {
      lens,
      result,
      written: null,
      refusedBy: 'forbidden' as const,
      issues: denied.map((field) => ({ path: `/${field.apiKey}`, code: 'FORBIDDEN_FIELD', message: '403' })),
    };
  }
  // `deliveryPatch`: component fields the caller cannot read are carried over from the stored draft.
  const kept = keepUnreadableComponentFields(
    patch,
    stored,
    today.model.fields,
    (componentId) => componentById(today, componentId) as ComponentDefinition | undefined,
    (field) => componentFieldReadable(field.id),
    { input: result.input, lens },
  );
  const outcome = validator.validate(applyPatch(stored, kept), { skipRequired: true });
  return outcome.issues.length > 0
    ? { lens, result, written: null, refusedBy: 'validation' as const, issues: outcome.issues }
    : { lens, result, written: outcome.data, refusedBy: null };
};

/** Values the write changed that it must not: fields it cannot write, fields the client does not know. */
const writeDamage = (
  lens: DefinitionLens,
  today: Schema,
  stored: ContentData,
  written: ContentData,
): string[] => {
  const damage: string[] = [];
  const byId = new Map(lens.fields.map((field) => [field.fieldId, field]));
  for (const field of today.model.fields) {
    const clientField = byId.get(field.id);
    const before = stored[field.id];
    const after = written[field.id];
    if (!clientField && !same(before, after)) {
      damage.push(`/${field.apiKey} (added since V): ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    } else if (clientField && !isWritable(clientField) && !same(before, after)) {
      damage.push(
        `/${field.apiKey} (${clientField.kind}): ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
      );
    } else if (clientField && clientField.kind !== 'null' && isWritable(clientField) && clientField.nested) {
      damage.push(...instanceDamage(clientField, today, before, after, `/${field.apiKey}`));
    }
  }
  for (const key of Object.keys(stored)) {
    if (!today.model.fields.some((field) => field.id === key) && !same(stored[key], written[key])) {
      damage.push(`/${key} (no field today): stored value changed`);
    }
  }
  return damage;
};

/**
 * Inside component values written whole (property 8, restated for the item-matching rule of
 * `keepUnreadableComponentFields`): what the client cannot write or does not know (its "hidden" part) is kept
 * for a single instance; in a list, an item may keep only the hidden part of a stored item it continues: one
 * equal in what the client sees, or the one at its position when the list kept its length. A new item may lose
 * it. A stored item continued unambiguously (the only one with that content, sent once) keeps it exactly.
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
  /** The client-visible and hidden parts of an item (storage form), and its writable containers. */
  const split = (item: unknown) => {
    const componentId = componentIdOf(item);
    const nested = field.nested?.components.get(componentId);
    const component = componentById(today, componentId);
    const visible: Record<string, unknown> = { kind: componentId };
    const hidden: Record<string, unknown> = {};
    const containers: Array<[FieldLens, FieldDefinition]> = [];
    if (!nested || !component || !isRecord(item)) {
      return {
        visible: canonicalJson(visible),
        hidden: '{}',
        containers,
        item: {} as Record<string, unknown>,
      };
    }
    const lensById = new Map(nested.fields.map((candidate) => [candidate.fieldId, candidate]));
    for (const componentField of component.fields) {
      const clientField = lensById.get(componentField.id);
      const value = item[componentField.id];
      if (value === undefined || value === null) {
        continue;
      }
      if (clientField && isWritable(clientField) && !componentField.deprecated) {
        visible[componentField.id] = value;
        if (componentField.type === 'component' || componentField.type === 'dynamiczone') {
          containers.push([clientField, componentField]);
        }
      } else {
        hidden[componentField.id] = value;
      }
    }
    return { visible: canonicalJson(visible), hidden: canonicalJson(hidden), containers, item };
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
  const count = (items: Array<ReturnType<typeof split>>, visible: string) =>
    items.filter((item) => item.visible === visible).length;
  return nows.flatMap((now, index) => {
    const at = `${path}/${index}`;
    const sameContent = olds.filter((old) => old.visible === now.visible);
    const inPlace =
      before.length === after.length &&
      olds[index] &&
      componentIdOf(before[index]) === componentIdOf(after[index])
        ? [olds[index]]
        : [];
    const allowed = [...sameContent, ...inPlace];
    if (now.hidden !== canonicalJson({}) && !allowed.some((old) => old.hidden === now.hidden)) {
      return [`${at}: hidden ${now.hidden} came from no stored item it continues`];
    }
    const unique = sameContent.length === 1 && count(nows, now.visible) === 1 ? sameContent[0] : undefined;
    if (unique && unique.hidden !== now.hidden) {
      return [`${at}: continues the only stored item like it, but hidden ${unique.hidden} → ${now.hidden}`];
    }
    const continued = unique ?? allowed.find((old) => old.hidden === now.hidden);
    return continued ? nestedDamage(continued, now, at) : [];
  });
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
          client.model.fields.forEach((field, index) => {
            const source = sources[index];
            const value = source === 'fresh' ? fresh[field.apiKey] : readBack[field.apiKey];
            if (source !== 'absent' && value !== undefined) {
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
            problems.push(...writeDamage(outcome.lens, today, todayData, outcome.written));
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
const writeLists = (mode: ListMode, stored: ContentData, body: Record<string, unknown>) => {
  const { today, atV } = listSchemas();
  const withLens = mode === 'lens' || mode === 'noReadLens';
  const mayRead = mode === 'public' || mode === 'lens';
  const all = fieldsById(today);
  const componentReadable = (fieldId: string) => {
    const field = all.get(fieldId)?.field;
    return mayRead && field !== undefined && field.public && !field.deprecated;
  };
  let input = body;
  const lens = withLens ? lensBetween(today, atV) : null;
  if (lens) {
    const read = readableThroughLens(lens, readThroughLens(lens, stored), () => mayRead, componentReadable);
    const result = writeThroughLens(lens, body, {
      stored,
      reads: mayRead ? [read] : [],
      definitionOf: definitionOfToday(today),
      readable: () => mayRead,
      componentFieldReadable: componentReadable,
    });
    expect(result.issues).toEqual([]);
    input = result.input;
  }
  const { patch, issues } = validatorOf(today).fromInput(input);
  expect(issues).toEqual([]);
  const kept = keepUnreadableComponentFields(
    patch,
    stored,
    today.model.fields,
    (componentId) => componentById(today, componentId) as ComponentDefinition | undefined,
    (field) => componentReadable(field.id),
    { mayRead, input, lens },
  );
  return applyPatch(stored, kept);
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
        // may carry them only by the documented in-place rule.
        // Not indistinguishable to the caller: allowed only by the documented in-place rule.
        const documentedInPlace =
          stored.length === sent.length &&
          source === position &&
          (stored[source] as StoredItem).kind === item.kind;
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
    const written = writeLists(mode, stored, body);
    const a = provenanceProblems(mode, items, sentItems, written[ITEMS], false);
    const b = provenanceProblems(mode, blocks, sentBlocks, written[BLOCKS], true);
    return {
      real: [...a.real.map((line) => `items ${line}`), ...b.real.map((line) => `blocks ${line}`)],
      inPlace: [...a.inPlace, ...b.inPlace],
      message: `mode ${mode}\n  stored ${JSON.stringify(stored)}\n  sent ${JSON.stringify({ sentItems, sentBlocks })}\n  written ${JSON.stringify(written)}`,
    };
  };

  it('12. hidden and unknown values stay with their item: untouched items keep them, nothing moves to another item', () => {
    fc.assert(
      fc.property(caseArb, (input) => {
        const { real, message } = run(input);
        expect(real, message).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it.fails(
    '12b. an edited-and-moved or new item carries nothing (as stated; the documented in-place rule breaks it)',
    () => {
      // Kept recorded by decision (2026-11-10): the in-place rule stays (wiping hidden values on every in-place
      // edit was the original data-loss bug). Item IDs are the real fix, a separate future change.
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
      // two apart from the body alone (items have no IDs); recorded so the trade-off stays visible. Decision
      // (2026-11-10): documented behaviour; item IDs are the real fix, a separate future change.
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
