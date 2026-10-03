import { classifyLocaleChange, type LocaleDefinition, type LocaleChangeKind } from '@shapio/schema';
import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { enqueueJob } from '../jobs/queue.js';
import * as localesRepository from '../repositories/locales.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import { acknowledgementRequired } from '../schema/errors.js';
import { toLocaleDefinition } from '../schema/loadSnapshot.js';
import { publishSchemaChanged } from '../schema/notify.js';
import { lockSchema } from '../schema/planner/locks.js';
import { SCHEMA_FOLLOW_UP_JOB } from '../schema/planner/prerequisites.js';
import { recordAudit } from './audit.js';
import { assertCanCreate, type SchemaServiceContext } from './schemaAccess.js';

/**
 * Locales are part of the schema snapshot (delivery fallbacks, localized fields), so every change bumps the
 * global schema version under the schema lock, with its audit row, outbox event and notification.
 */

export type LocaleInputBody = { code: string; label: string; fallbacks?: string[] };

const notFound = (code: string) => new AppError(404, 'NOT_FOUND', `No locale "${code}"`);

const checkFallbacks = (code: string, fallbacks: readonly string[], known: ReadonlySet<string>) => {
  const problems = fallbacks.flatMap((fallback, index) => {
    if (fallback === code) {
      return [{ path: `/fallbacks/${index}`, message: 'a locale cannot fall back to itself' }];
    }
    if (!known.has(fallback)) {
      return [{ path: `/fallbacks/${index}`, message: `unknown locale "${fallback}"` }];
    }
    return fallbacks.indexOf(fallback) !== index
      ? [{ path: `/fallbacks/${index}`, message: 'listed twice' }]
      : [];
  });
  if (problems.length > 0) {
    throw new AppError(422, 'LOCALE_INVALID', 'The fallback chain is invalid.', { issues: problems });
  }
};

/** Runs a locale change with the version bump, audit, outbox and notification in one transaction. */
const commitLocaleChange = async <T>(
  context: SchemaServiceContext,
  change: { kind: LocaleChangeKind; code: string; metadata?: Record<string, unknown> },
  write: (trx: Transaction<DB>, now: Date) => Promise<T>,
): Promise<T> =>
  context.db.transaction().execute(async (trx) => {
    const now = new Date();
    await lockSchema(trx);
    const result = await write(trx, now);
    const schemaVersion = await schemaVersionsRepository.bumpSchemaVersion(trx, now);
    const classified = classifyLocaleChange(change.kind, change.code);
    const metadata = {
      ...change.metadata,
      change: classified.kind,
      category: classified.category,
      schemaVersion,
    };
    await recordAudit(trx, {
      actor: context.actor,
      action:
        change.kind === 'locale.added'
          ? 'locale.create'
          : change.kind === 'locale.removed'
            ? 'locale.delete'
            : 'locale.update',
      target: { type: 'locale', id: change.code },
      metadata,
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
    });
    await writeOutboxEvent(trx, {
      type: change.kind,
      aggregateType: 'locale',
      aggregateId: change.code,
      payload: metadata,
      // Locales are instance-wide: a network event.
      siteId: null,
    });
    await publishSchemaChanged(trx, schemaVersion);
    return result;
  });

export const listLocales = async (context: SchemaServiceContext): Promise<readonly LocaleDefinition[]> =>
  context.snapshot.locales;

export const createLocale = async (
  context: SchemaServiceContext,
  input: LocaleInputBody,
): Promise<LocaleDefinition> => {
  await assertCanCreate(context);
  const known = new Set(context.snapshot.locales.map((locale) => locale.code));
  if (known.has(input.code)) {
    throw new AppError(409, 'LOCALE_EXISTS', `Locale "${input.code}" already exists`);
  }
  checkFallbacks(input.code, input.fallbacks ?? [], known);
  const row = await commitLocaleChange(context, { kind: 'locale.added', code: input.code }, (trx) =>
    localesRepository.insert({ code: input.code, label: input.label, fallbacks: input.fallbacks ?? [] }, trx),
  );
  return toLocaleDefinition(row);
};

export const updateLocale = async (
  context: SchemaServiceContext,
  code: string,
  input: { label: string; fallbacks?: string[] },
): Promise<LocaleDefinition> => {
  await assertCanCreate(context);
  const known = new Set(context.snapshot.locales.map((locale) => locale.code));
  if (!known.has(code)) {
    throw notFound(code);
  }
  checkFallbacks(code, input.fallbacks ?? [], known);
  const row = await commitLocaleChange(context, { kind: 'locale.metadata', code }, (trx, now) =>
    localesRepository.update(code, { label: input.label, fallbacks: input.fallbacks ?? [], now }, trx),
  );
  if (!row) {
    throw notFound(code);
  }
  return toLocaleDefinition(row);
};

/**
 * Changing the default locale changes what delivery falls back to (a contract change), so the caller must
 * acknowledge it; the plan reports how many heads lack the new default.
 */
export const setDefaultLocale = async (
  context: SchemaServiceContext,
  code: string,
  acknowledgeBreaking: boolean,
) => {
  await assertCanCreate(context);
  if (!context.snapshot.locales.some((locale) => locale.code === code)) {
    throw notFound(code);
  }
  if (context.snapshot.defaultLocale === code) {
    return { code, changed: false };
  }
  if (!acknowledgeBreaking) {
    throw acknowledgementRequired({
      change: classifyLocaleChange('locale.defaultChanged', code),
      impact: { previousDefault: context.snapshot.defaultLocale },
    });
  }
  await commitLocaleChange(
    context,
    { kind: 'locale.defaultChanged', code, metadata: { previousDefault: context.snapshot.defaultLocale } },
    (trx, now) => localesRepository.setDefault(code, now, trx),
  );
  return { code, changed: true };
};

/**
 * Deleting a locale removes it from delivery at once and purges its content in a follow-up job, so it is
 * destructive and needs explicit acknowledgement when content exists. The default locale cannot be deleted.
 */
export const deleteLocale = async (
  context: SchemaServiceContext,
  code: string,
  acknowledgeDestructive: boolean,
) => {
  await assertCanCreate(context);
  if (!context.snapshot.locales.some((locale) => locale.code === code)) {
    throw notFound(code);
  }
  if (context.snapshot.defaultLocale === code) {
    throw new AppError(422, 'LOCALE_IS_DEFAULT', 'Choose another default locale before deleting this one.');
  }
  const affectedHeads = await context.ports.impact.countLocaleHeads(code);
  if (affectedHeads > 0 && !acknowledgeDestructive) {
    throw acknowledgementRequired({
      change: classifyLocaleChange('locale.removed', code),
      impact: { affectedHeads },
    });
  }
  await commitLocaleChange(
    context,
    { kind: 'locale.removed', code, metadata: { affectedHeads } },
    async (trx, now) => {
      await localesRepository.remove(code, trx);
      await localesRepository.removeFromFallbacks(code, now, trx);
      await enqueueJob(
        {
          type: SCHEMA_FOLLOW_UP_JOB,
          payload: { definitionId: null, steps: [{ kind: 'purgeLocale', code }] },
          idempotencyKey: `${SCHEMA_FOLLOW_UP_JOB}:locale:${code}:${now.getTime()}`,
        },
        trx,
      );
    },
  );
  return { code, affectedHeads };
};
