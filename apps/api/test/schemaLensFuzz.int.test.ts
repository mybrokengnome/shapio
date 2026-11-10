import { appendFileSync } from 'node:fs';
import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type FieldBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { instanceIssues, isEmptyApiValue } from './helpers/lensOracles.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Schema lenses, fuzzed through the real HTTP API and the real activation path (plan schema-lenses). Each
 * seeded run creates a model with random fields and published entries, records schema version V and what a
 * public token reads at V, applies 3–5 random changes through `PUT /api/admin/models/:id` and the schema jobs,
 * then reads the same entries naming V: 200, only V's API IDs, V-typed values, removed fields empty, and with a
 * sequence of only renames, reorders, relabels and additions, exactly what V returned. A failure prints the seed;
 * `LENS_FUZZ_SEED=<n>` replays one run. `LENS_FUZZ_RUNS` changes the count (default 30).
 */

const RUNS = Number(process.env.LENS_FUZZ_RUNS ?? 30);
const BASE_SEED = Number(process.env.LENS_FUZZ_SEED ?? 20261110);
const SINGLE = process.env.LENS_FUZZ_SEED !== undefined;
/** `LENS_FUZZ_LOG=<file>` appends every run's log there (what was created, changed and read). */
const LOG_FILE = process.env.LENS_FUZZ_LOG;

/** mulberry32: a small deterministic PRNG, so a seed replays the same run. */
const prng = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
  const chance = (p: number) => next() < p;
  return { int, pick, chance };
};
type Random = ReturnType<typeof prng>;

const TYPES = [
  'string',
  'text',
  'code',
  'richtext',
  'number',
  'integer',
  'decimal',
  'biginteger',
  'boolean',
  'date',
  'datetime',
  'time',
  'enum',
  'json',
  'slug',
  'email',
  'url',
  'uid',
] as const;
type FuzzType = (typeof TYPES)[number];
const KEYS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
const ENUM_VALUES = ['a', 'b', 'c', 'd'];

const settingsFor = (type: FuzzType, random: Random): Record<string, unknown> => {
  if (type === 'enum') {
    const values = ENUM_VALUES.filter(() => random.chance(0.6));
    return {
      values: (values.length > 0 ? values : ['a']).map((value) => ({ value, label: value })),
      multiple: random.chance(0.5),
    };
  }
  return {};
};

const VALUES: Record<FuzzType, readonly unknown[]> = {
  string: ['12', 'Hello', '4.5', 'a', 'true', '2024-02-29'],
  text: ['Long text', '7', 'b'],
  code: ['<p>x</p>', '42'],
  richtext: ['rich'],
  number: [4, 4.5, -3, 0.1, 1e-7],
  integer: [4, -3, 1000],
  decimal: ['12.5', '-3', '0.001'],
  biginteger: ['123', '123456789012345678901'],
  boolean: [true, false],
  date: ['2024-02-29', '2026-11-10'],
  datetime: ['2026-11-10T14:02:19.880Z'],
  time: ['10:30', '23:59:59'],
  enum: [],
  json: [{ a: 1 }, [1, 'x'], 'plain', 3],
  slug: ['summer-sale', 'a'],
  email: ['x@y.co'],
  url: ['https://shapio.dev/a'],
  uid: ['abc', 'A_b.c'],
};

const richText = (text: string) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});

const valueFor = (field: FieldBody, random: Random): unknown => {
  const type = field.type as FuzzType;
  if (type === 'enum') {
    const settings = field.settings as { values: Array<{ value: string }>; multiple?: boolean };
    const values = settings.values.map((entry) => entry.value);
    return settings.multiple ? values.filter(() => random.chance(0.5)).slice(0, 2) : random.pick(values);
  }
  if (type === 'richtext') {
    return richText(String(random.pick(VALUES.string)));
  }
  return random.pick(VALUES[type]);
};

type ChangeKind =
  | 'renameField'
  | 'renameModel'
  | 'reorder'
  | 'label'
  | 'addField'
  | 'removeField'
  | 'removeReadd'
  | 'retype'
  | 'enumValues'
  | 'flipMultiple'
  | 'public'
  | 'deprecated';
const TRANSPARENT: readonly ChangeKind[] = ['renameField', 'renameModel', 'reorder', 'label', 'addField'];
const ALL_CHANGES: readonly ChangeKind[] = [
  ...TRANSPARENT,
  'removeField',
  'removeReadd',
  'retype',
  'enumValues',
  'flipMultiple',
  'public',
  'deprecated',
];

/** A definition as sent to the admin API: fields may lack an ID (a new field). */
type DraftField = Record<string, unknown>;
type Definition = { id: string; apiKey: string; fields: DraftField[] } & Record<string, unknown>;

const freeKey = (definition: Definition, random: Random) => {
  const used = new Set(definition.fields.map((field) => String(field.apiKey)));
  const free = KEYS.filter((key) => !used.has(key));
  return free.length > 0 ? random.pick(free) : `k${random.int(1000)}`;
};

const newField = (definition: Definition, random: Random, apiKey = freeKey(definition, random)) => {
  const type = random.pick(TYPES);
  return { apiKey, label: apiKey, type, settings: settingsFor(type, random) };
};

/** One change to the model's definition, as the admin would send it; null when it does not apply. */
const changed = (
  definition: Definition,
  kind: ChangeKind,
  random: Random,
  run: number,
): Definition | null => {
  const fields = definition.fields;
  const index = random.int(fields.length);
  const field = fields[index] as unknown as FieldBody;
  const replace = (next: Record<string, unknown>) => ({
    ...definition,
    fields: fields.map((candidate, position) => (position === index ? next : candidate)),
  });
  const retyped = ({ editor: _editor, ...rest }: FieldBody, type: FuzzType) => ({
    ...rest,
    type,
    settings: settingsFor(type, random),
    unique: false,
    filterable: false,
    sortable: false,
  });
  switch (kind) {
    case 'renameField':
      return replace({ ...field, apiKey: freeKey(definition, random) });
    case 'renameModel': {
      const suffix = `x${random.int(100)}`;
      return { ...definition, apiKey: `r${run}page${suffix}`, pluralApiKey: `r${run}pages${suffix}` };
    }
    case 'reorder':
      return fields.length < 2 ? null : { ...definition, fields: [...fields].reverse() };
    case 'label':
      return replace({ ...field, label: `Relabeled ${random.int(100)}` });
    case 'addField':
      return { ...definition, fields: [...fields, newField(definition, random)] };
    case 'removeField':
      return fields.length < 2
        ? null
        : { ...definition, fields: fields.filter((_, position) => position !== index) };
    case 'removeReadd':
      // Two activations (the loop adds it back under the same API ID): in one PUT, a field sent without its ID
      // under an existing API ID keeps that field's ID, which is a type change, not a new field.
      return fields.length < 2
        ? null
        : { ...definition, fields: fields.filter((_, position) => position !== index), readd: field.apiKey };
    case 'retype': {
      const type = random.pick(TYPES.filter((candidate) => candidate !== field.type));
      return replace(retyped(field, type));
    }
    case 'enumValues': {
      const enums = fields.filter((candidate) => candidate.type === 'enum');
      if (enums.length === 0) {
        return null;
      }
      const target = random.pick(enums);
      const values = ENUM_VALUES.filter(() => random.chance(0.6));
      return {
        ...definition,
        fields: fields.map((candidate) =>
          candidate === target
            ? {
                ...candidate,
                settings: {
                  ...(candidate.settings as object),
                  values: (values.length > 0 ? values : ['a']).map((value) => ({ value, label: value })),
                },
              }
            : candidate,
        ),
      };
    }
    case 'flipMultiple': {
      const enums = fields.filter((candidate) => candidate.type === 'enum');
      if (enums.length === 0) {
        return null;
      }
      const target = random.pick(enums);
      const settings = target.settings as { multiple?: boolean };
      return {
        ...definition,
        fields: fields.map((candidate) =>
          candidate === target
            ? { ...candidate, settings: { ...settings, multiple: !settings.multiple } }
            : candidate,
        ),
      };
    }
    case 'public':
      return replace({ ...field, public: field.public === false });
    case 'deprecated':
      return replace({ ...field, deprecated: field.deprecated !== true });
  }
};

const SYSTEM_KEYS = new Set(['id', '__model', '__kinds', 'locale', 'createdAt', 'updatedAt', 'publishedAt']);
const withoutTimes = (entry: Record<string, unknown>) => {
  const { createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = entry;
  return rest;
};

describe('schema lenses, fuzzed through the HTTP API', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  beforeAll(async () => {
    // Many requests from one address: the default rate limit would cut a long run (`LENS_FUZZ_RUNS`) short.
    testApp = await createPublishingTestApp(database.current, { env: { RATE_LIMIT_MAX: '1000000' } });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });
  /** Activations and V reads across the runs, so a fuzz that silently does nothing fails. */
  const totals = { activated: 0, reads: 0, entries: 0 };
  afterAll(async () => {
    await testApp.app.close();
    if (!SINGLE) {
      expect(totals.entries).toBeGreaterThan(RUNS);
      expect(totals.activated).toBeGreaterThan(RUNS * 2);
      expect(totals.reads).toBe(totals.entries);
    }
  });

  const seeds = SINGLE ? [BASE_SEED] : Array.from({ length: RUNS }, (_, run) => BASE_SEED + run);

  it.each(seeds)(
    'seed %i: an old client reads V-shaped, V-named, V-typed values',
    { timeout: 60_000 },
    async (seed) => {
      const random = prng(seed);
      const run = seed % 100_000;
      const log: string[] = [`seed ${seed} (replay: LENS_FUZZ_SEED=${seed})`];
      const fail = (message: string) => `${message}\n${log.join('\n')}`;
      try {
        // 1. A model with 1–6 random fields and 1–3 published entries.
        const fieldCount = 1 + random.int(6);
        const start: Definition = { id: '', apiKey: `r${run}page`, fields: [] };
        for (let index = 0; index < fieldCount; index += 1) {
          start.fields.push(newField(start, random));
        }
        let model = await createDefinition(admin, {
          kind: 'collection',
          apiKey: start.apiKey,
          pluralApiKey: `r${run}pages`,
          label: `Run ${run}`,
          fields: start.fields,
        });
        log.push(
          `V model: ${JSON.stringify(model.definition.fields.map((f) => [f.apiKey, f.type, f.settings]))}`,
        );
        const entryIds: string[] = [];
        for (let count = 1 + random.int(3); count > 0; count -= 1) {
          let data = Object.fromEntries(
            model.definition.fields
              .filter(() => random.chance(0.8))
              .map((field) => [field.apiKey, valueFor(field, random)]),
          );
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const created = await admin.post(`/api/admin/content/${model.definition.apiKey}`, {
              data,
              publish: true,
            });
            if (created.statusCode === 201) {
              entryIds.push(created.json<EntryBody>().id);
              totals.entries += 1;
              log.push(`entry: ${JSON.stringify(data)}`);
              break;
            }
            const issues =
              created.json<{ error: { details?: { issues?: Array<{ path: string }> } } }>().error.details
                ?.issues ?? [];
            const bad = new Set(issues.map((issue) => issue.path.split('/')[1]));
            data = Object.fromEntries(Object.entries(data).filter(([key]) => !bad.has(key)));
          }
        }
        const token = await createDeliveryToken(database.current.db, [{ modelId: model.definition.id }]);
        const get = (url: string) =>
          testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
        const v = expectStatus(await get('/api/snapshots/current'), 200).json<{
          schemaVersionToken: string;
        }>().schemaVersionToken;
        const clientRoute = `/api/content/r${run}pages`;
        const at = (url: string) =>
          `${url}${url.includes('?') ? '&' : '?'}schemaVersion=${encodeURIComponent(v)}`;
        const clientDefinition = model.definition as unknown as SchemaDefinition;
        const before = new Map<string, Record<string, unknown>>();
        for (const id of entryIds) {
          before.set(
            id,
            expectStatus(await get(at(`${clientRoute}/${id}`)), 200).json<{ data: Record<string, unknown> }>()
              .data,
          );
        }

        // 2. Three to five random changes through the real activation path.
        const transparentOnly = random.chance(1 / 3);
        const kinds = transparentOnly ? TRANSPARENT : ALL_CHANGES;
        for (let count = 3 + random.int(3); count > 0; count -= 1) {
          const kind = random.pick(kinds);
          const next = changed(model.definition, kind, random, run);
          if (!next) {
            continue;
          }
          const { readd, ...definition } = next as Definition & { readd?: string };
          const apply = async (body: Definition, label: string) => {
            const response = await admin.put(`/api/admin/models/${model.definition.id}`, {
              definition: body,
              expectedVersion: model.version,
              acknowledgeBreaking: true,
              acknowledgeDestructive: true,
            });
            await runContentSchemaJobs(database.current.db);
            const reloaded = (await admin.get(`/api/admin/models/${model.definition.id}`)).json<ModelBody>();
            log.push(
              `${label} → ${response.statusCode}${reloaded.version === model.version ? ' (not activated)' : ''}: ${JSON.stringify(reloaded.definition.fields.map((f) => [f.apiKey, f.id.slice(-4), f.type, f.public === false ? 'private' : '', f.deprecated ? 'deprecated' : '']))}`,
            );
            if (reloaded.version !== model.version) {
              totals.activated += 1;
            }
            model = reloaded;
          };
          await apply(definition, kind);
          if (readd !== undefined && !model.definition.fields.some((field) => field.apiKey === readd)) {
            await apply(
              {
                ...model.definition,
                fields: [...model.definition.fields, newField(model.definition, random, readd)],
              },
              `${kind} (re-add ${readd})`,
            );
          }
        }
        const todayIds = new Set(model.definition.fields.map((field) => field.id));

        // 3. Read naming V.
        for (const id of entryIds) {
          const response = await get(at(`${clientRoute}/${id}`));
          expect(response.statusCode, fail(`GET ${id}: ${response.body}`)).toBe(200);
          const body = response.json<{ data: Record<string, unknown>; meta: Record<string, unknown> }>();
          totals.reads += 1;
          log.push(`V read ${id.slice(-4)}: ${JSON.stringify(withoutTimes(body.data))}`);
          const values = Object.fromEntries(
            Object.entries(body.data).filter(([key]) => !SYSTEM_KEYS.has(key)),
          );
          expect(body.data.__model, fail('__model is not V’s API ID')).toBe(`r${run}page`);
          expect(
            instanceIssues(clientDefinition, values, () => undefined, '', { delivery: true }),
            fail('values are not V-shaped'),
          ).toEqual([]);
          const resurrected = (clientDefinition.fields as FieldDefinition[]).filter(
            (field) => !todayIds.has(field.id) && !isEmptyApiValue(values[field.apiKey]),
          );
          expect(
            resurrected.map((field) => field.apiKey),
            fail('a removed field has a value'),
          ).toEqual([]);
          if (transparentOnly) {
            expect(withoutTimes(body.data), fail('renames only, yet the V read changed')).toEqual(
              withoutTimes(before.get(id) ?? {}),
            );
          }
        }
        const list = await get(at(`${clientRoute}?pageSize=100`));
        expect(list.statusCode, fail(`list: ${list.body}`)).toBe(200);
        expect(list.json<{ data: unknown[] }>().data).toHaveLength(entryIds.length);
        if (LOG_FILE) {
          appendFileSync(LOG_FILE, `${log.join('\n')}\n\n`);
        }
      } catch (error) {
        if (LOG_FILE) {
          appendFileSync(LOG_FILE, `FAILED ${log.join('\n')}\n\n`);
        }
        if (error instanceof Error && !error.message.includes(`seed ${seed}`)) {
          error.message = fail(error.message);
        }
        throw error;
      }
    },
  );
});
