import { createClient } from '@shapio/client';
import { foldApiKey, generatedNames, routeKeyOf, suggestPlural, type SchemaDefinition } from '@shapio/schema';
import { createRateLimitedFetch } from '../helpers/rateLimitRetry.js';
import { withSuffix } from './naming.js';
import { assignIds, buildDefinitions } from './planner.js';
import type { ImportSource, PlannedDefinition } from './types.js';

/**
 * `--plan --url <instance>`: planned API IDs and the GraphQL names they generate are checked against the
 * definitions the planned site can already see, so `schema apply` does not refuse the plan with
 * `API_KEY_COLLISION` or `GENERATED_NAME_COLLISION`. A planned definition that clashes is renamed (`seo` →
 * `seoItem`, then `seoItem2`, ...) and the plan output says so. Without a URL the plan stays offline and says the
 * names were not checked.
 */
export const NAMES_NOT_CHECKED_NOTE =
  'Names were not checked against a target: pass --url and --token to --plan, or rename clashes in the schema files before applying.';

export const SHARED_PLAN_NOTE =
  "Names were checked against the primary site's view: other sites' own definitions were not checked.";

export type TargetOptions = {
  baseUrl: string;
  token: string;
  /** The site whose view (shared definitions and its own) the plan must fit. */
  site: string;
  fetch?: typeof globalThis.fetch;
};

/** The definitions the site can see: the same export `--map` reads. */
export const fetchTargetDefinitions = async ({
  baseUrl,
  token,
  site,
  fetch,
}: TargetOptions): Promise<SchemaDefinition[]> => {
  const client = createClient({ baseUrl, token, site, fetch: createRateLimitedFetch(fetch) });
  const exported = await client.admin.schema.export();
  return exported.definitions.map((entry) => entry.definition);
};

type Claim = { claim: string; owner: string };

/**
 * Every folded name a definition holds: its API ID and plural API ID (one shared namespace, `key:`), and each
 * generated GraphQL name in its own namespace (`type:`, `query:`, `mutation:`). `owner` is what a note names.
 */
const claimsOf = (definition: SchemaDefinition): Claim[] => {
  const keys = [definition.apiKey];
  if (definition.kind === 'collection') {
    keys.push(routeKeyOf(definition));
  }
  return [
    ...keys.map((key) => ({ claim: `key:${foldApiKey(key)}`, owner: key })),
    ...generatedNames(definition).map((name) => ({
      claim: `${name.namespace}:${foldApiKey(name.name)}`,
      owner: definition.apiKey,
    })),
  ];
};

const renamed = (definition: SchemaDefinition, apiKey: string): SchemaDefinition =>
  definition.kind === 'collection'
    ? { ...definition, apiKey, pluralApiKey: suggestPlural(apiKey) }
    : { ...definition, apiKey };

/** `seoItem`, `seoItem2`, ...: the first whose names are free among `taken`. */
const freeApiKey = (definition: SchemaDefinition, taken: ReadonlySet<string>): string => {
  const base = withSuffix(definition.apiKey, 'Item');
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : withSuffix(base, String(n));
    if (!claimsOf(renamed(definition, candidate)).some(({ claim }) => taken.has(claim))) {
      return candidate;
    }
  }
};

const KIND_LABEL: Record<PlannedDefinition['kind'], string> = {
  collection: 'Model',
  singleton: 'Model',
  component: 'Component',
};

/**
 * Renames the planned definitions whose names the target already holds, one at a time (a rename changes the
 * names the next check sees), until the plan fits. A renamed definition loses its planned plural API ID, so it
 * is derived from the new API ID. Entries address definitions by source key, so they follow.
 */
export const avoidTargetNames = (source: ImportSource, target: readonly SchemaDefinition[]): ImportSource => {
  const owners = new Map(target.flatMap(claimsOf).map(({ claim, owner }) => [claim, owner]));
  let definitions = source.definitions;
  const notes: string[] = [];
  for (let round = 0; round <= source.definitions.length; round += 1) {
    const ids = assignIds(definitions);
    const built = buildDefinitions({ ...source, definitions }, ids);
    const keyOf = new Map(Object.entries(ids).map(([key, planned]) => [planned.id, key]));
    const clash = built
      .map((definition) => ({
        definition,
        hit: claimsOf(definition).find(({ claim }) => owners.has(claim)),
      }))
      .find(({ hit }) => hit !== undefined);
    if (!clash?.hit) {
      return { ...source, definitions, notes: [...source.notes, ...notes] };
    }
    const taken = new Set([
      ...owners.keys(),
      ...built
        .filter((definition) => definition !== clash.definition)
        .flatMap((definition) => claimsOf(definition).map(({ claim }) => claim)),
    ]);
    const apiKey = freeApiKey(clash.definition, taken);
    const key = keyOf.get(clash.definition.id);
    definitions = definitions.map((planned) => {
      if (planned.key !== key) {
        return planned;
      }
      const { pluralApiKey: _dropped, ...rest } = planned;
      return { ...rest, apiKey };
    });
    notes.push(
      `${KIND_LABEL[clash.definition.kind]} ${clash.definition.apiKey} is named ${apiKey} (the target already has ${owners.get(clash.hit.claim)}).`,
    );
  }
  throw new Error('Import plan bug: renaming planned definitions away from the target did not settle');
};

/** The plan step: checks names against the target when one is given, else notes that they were not. */
export const checkTargetNames = async (
  source: ImportSource,
  target: (TargetOptions & { shared: boolean }) | undefined,
): Promise<ImportSource> => {
  if (!target) {
    return { ...source, notes: [...source.notes, NAMES_NOT_CHECKED_NOTE] };
  }
  const checked = avoidTargetNames(source, await fetchTargetDefinitions(target));
  return target.shared ? { ...checked, notes: [...checked.notes, SHARED_PLAN_NOTE] } : checked;
};
