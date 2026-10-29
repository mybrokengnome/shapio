import { isModelDefinition } from '@shapio/schema';
import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import * as entriesRepository from '../repositories/entries.js';
import * as sitesRepository from '../repositories/sites.js';
import { schemaInvalid, schemaVersionConflict, scopeOfChildType } from '../schema/errors.js';
import {
  activateDefinitions,
  type ActivationItem,
  type ActivationResult,
} from '../schema/planner/activate.js';
import { buildChangePlan } from '../schema/planner/plan.js';
import { validateScoped, type ScopedDefinition } from '../schema/scopedValidation.js';
import { recordAudit } from './audit.js';
import { seesEverySite } from './networkScope.js';
import { assertCanChangeNetworkSchema, assertCanManage, type SchemaServiceContext } from './schemaAccess.js';
import {
  activeOf,
  assertWritable,
  plannerInputOf,
  type DefinitionCategory,
  type DefinitionScope,
} from './schemaDefinitions.js';

/**
 * Sharing a definition with every site, or keeping it on one (plan site-schema, rule 2). A scope change is
 * metadata: it writes a new revision of the same definition (so the per-model version moves and every
 * editor's optimistic token with it), bumps the global schema version and takes no snapshot (rule 7).
 * Site → shared needs every view to stay valid with the definition in it; shared → site needs no other site
 * to hold an entry of it (checked again under the activation's exclusive lock, so no concurrent writer on
 * another site can slip one in) and nothing shared or on another site to reference it.
 */
export type ScopeChangeInput = {
  category: DefinitionCategory;
  id: string;
  scope: DefinitionScope;
  /** For `site`: the site to keep it on (default: the request's site). */
  siteId?: string | undefined;
  /** The definition's active version the caller saw. */
  expectedVersion: number;
};

export type ScopeChangeOutcome = {
  status: 'activated' | 'unchanged';
  definitionId: string;
  scope: DefinitionScope;
  siteId: string | null;
  version: number;
  schemaVersion: number;
};

type SiteEntryCount = { siteId: string; key: string | null; entries: number };

const scopeInUse = (counts: readonly SiteEntryCount[], detailed: boolean) => {
  const total = counts.reduce((sum, count) => sum + count.entries, 0);
  return new AppError(
    409,
    'SCOPE_IN_USE',
    `Other sites still have ${total} entr${total === 1 ? 'y' : 'ies'} of this content type; delete them before keeping it on one site.`,
    // Which sites, only for those who see every site (a site admin learns nothing about the others).
    detailed ? { entries: total, sites: counts } : { entries: total },
  );
};

const entriesElsewhere = async (
  executor: Parameters<typeof entriesRepository.countBySiteOutside>[2],
  modelId: string,
  siteId: string,
  siteKeys: ReadonlyMap<string, string>,
): Promise<SiteEntryCount[]> =>
  (await entriesRepository.countBySiteOutside(modelId, siteId, executor)).map((row) => ({
    siteId: row.site_id,
    key: siteKeys.get(row.site_id) ?? null,
    entries: Number(row.count),
  }));

const targetSiteOf = async (
  context: SchemaServiceContext,
  input: ScopeChangeInput,
): Promise<string | null> => {
  if (input.scope === 'network') {
    return null;
  }
  const siteId = input.siteId ?? context.snapshot.siteId;
  if (!siteId || !(await sitesRepository.findById(siteId, context.db))) {
    throw new AppError(404, 'SITE_NOT_FOUND', 'No such site');
  }
  return siteId;
};

export const changeScope = async (
  context: SchemaServiceContext,
  input: ScopeChangeInput,
): Promise<ScopeChangeOutcome> => {
  // Both directions change every site's view: network schema permission, plus the definition's own.
  await assertCanChangeNetworkSchema(context);
  await assertCanManage(context, input.id);
  await assertWritable(context);
  const active = activeOf(context, input.id, input.category);
  if (active.version !== input.expectedVersion) {
    throw schemaVersionConflict(input.expectedVersion, active.version);
  }
  const target = await targetSiteOf(context, input);
  if (target === active.siteId) {
    return {
      status: 'unchanged',
      definitionId: input.id,
      scope: input.scope,
      siteId: target,
      version: active.version,
      schemaVersion: context.snapshot.version,
    };
  }
  // A family moves together (plan polymorphic-types D3): from its root, every kind with it.
  const network = context.snapshot.network;
  const [rootId] = network.ancestors(input.id);
  if (rootId !== undefined) {
    throw scopeOfChildType(active.definition.apiKey, network.byId.get(rootId)?.definition.apiKey ?? rootId);
  }
  const family = new Set(network.family(input.id));
  const { active: all, siteKeys } = await plannerInputOf(context);
  const proposed: ScopedDefinition[] = all.map((entry) =>
    family.has(entry.definition.id) ? { definition: entry.definition, siteId: target } : entry,
  );
  // Both scopes' views: the one it leaves (references to it) and the one it joins (collisions there).
  const issues = validateScoped(proposed, [active.siteId, target], { siteKeys });
  if (issues.length > 0) {
    throw schemaInvalid(issues);
  }
  const detailed = seesEverySite(context.actor);
  const members = [...family].flatMap((id) => {
    const member = network.byId.get(id);
    return member ? [member] : [];
  });
  /** No other site may hold an entry of any member of the family. */
  const assertNoEntriesElsewhere = async (executor: Parameters<typeof entriesElsewhere>[0]) => {
    // Components and interfaces hold no entries of their own (an interface's members are checked by
    // validation: a site's interface may only have that site's members, plan interfaces D3).
    if (target === null || !isModelDefinition(active.definition)) {
      return;
    }
    for (const member of members) {
      const elsewhere = await entriesElsewhere(executor, member.definition.id, target, siteKeys);
      if (elsewhere.length > 0) {
        throw scopeInUse(elsewhere, detailed);
      }
    }
  };
  await assertNoEntriesElsewhere(context.db);
  // Each member is planned against the schema with the whole family moved, so no view sees a kind apart
  // from its parent; the root's plan affects the whole family.
  const items: ActivationItem[] = members.map((member) => ({
    plan: buildChangePlan({
      before: member.definition,
      after: member.definition,
      fromVersion: member.version,
      active: proposed,
      siteId: target,
      hasContent: true,
      siteKeys,
    }),
    after: member.definition,
    expectedVersion: member.version,
    moveScope: true,
  }));
  const [first, ...others] = items;
  const recheck = async (trx: Transaction<DB>) => {
    await assertNoEntriesElsewhere(trx);
    return undefined;
  };
  const results = await activateDefinitions(context.db, {
    items: [{ ...(first as ActivationItem), recheck }, ...others],
    actor: context.actor,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.ip ? { ip: context.ip } : {}),
    afterFlip: async (trx, flipped) => {
      await recordAudit(trx, {
        actor: context.actor,
        action: 'schema.scope',
        target: { type: input.category, id: input.id },
        metadata: {
          apiKey: active.definition.apiKey,
          from: active.siteId === null ? 'network' : { siteId: active.siteId },
          to: target === null ? 'network' : { siteId: target },
          schemaVersion: flipped.schemaVersion,
          // A family moves with its root.
          family: [...family],
        },
        ...(context.requestId ? { requestId: context.requestId } : {}),
        ...(context.ip ? { ip: context.ip } : {}),
      });
    },
  });
  const result = results.find((entry) => entry.definitionId === input.id) as ActivationResult;
  return {
    status: 'activated',
    definitionId: input.id,
    scope: input.scope,
    siteId: target,
    version: result.version ?? active.version,
    schemaVersion: result.schemaVersion,
  };
};
