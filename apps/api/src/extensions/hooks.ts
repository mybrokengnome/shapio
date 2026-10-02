import type { ModelDefinition } from '@shapio/schema';
import type { FastifyBaseLogger } from 'fastify';
import { AFTER_HOOK_JOB, EXTENSION_HOOK_EVENT } from '../constants/extensions.js';
import { projectData } from '../content/compiler/select.js';
import {
  AFTER_EVENTS,
  BEFORE_EVENTS,
  ENTRY_STATE_BY_EVENT,
  type AfterEvent,
  type BeforeEvent,
  type ContentHooks,
  type LifecycleContext,
  type LifecycleEvent,
} from '../content/hooks.js';
import type { ContentModel } from '../content/model.js';
import type { ContentData } from '../db/contentData.js';
import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { enqueueJob } from '../jobs/queue.js';
import { PermanentJobError, type JobHandler, type OutboxSubscriber } from '../jobs/types.js';
import type { Principal } from '../permissions/types.js';
import * as extensionHookRunsRepository from '../repositories/extensionHookRuns.js';
import * as outboxEventsRepository from '../repositories/outboxEvents.js';
import {
  HookError,
  isHookError,
  type EntryData,
  type ExtensionServices,
  type HookEntry,
  type HookModel,
  type ModelHooks,
} from './public.js';

/**
 * Project lifecycle hooks on top of the content hook engine (content/hooks.ts, ADR 0009):
 * - `before*` hooks run in the owning transaction; a `HookError` becomes 422 `HOOK_REJECTED` and the whole
 *   write rolls back.
 * - `after*` hook points write one `extensions.hook` outbox event in the owning transaction (only when a
 *   hook matches). The relay turns it into one job per hook (idempotency key: event ID + hook name), and the
 *   job runs the hook in its own transaction that also records the run, so it happens once per event.
 */
export type HookEnvironment = {
  db: Database;
  hooks: Readonly<Record<string, ModelHooks>>;
  services: ExtensionServices;
  logger: FastifyBaseLogger;
  signal: AbortSignal;
};

type MatchedHook<H> = { name: string; hook: H };

type ModelRef = { id: string; apiKey: string };

/** Hooks for an event, by model API key, then model ID, then `*` (each named `<key>.<event>`). */
export const matchHooks = <E extends LifecycleEvent>(
  hooks: Readonly<Record<string, ModelHooks>>,
  model: ModelRef,
  event: E,
): Array<MatchedHook<NonNullable<ModelHooks[E]>>> =>
  [...new Set([model.apiKey, model.id, '*'])].flatMap((key) => {
    const hook = hooks[key]?.[event];
    return hook ? [{ name: `${key}.${event}`, hook: hook }] : [];
  });

export const toHookModel = (definition: ModelDefinition): HookModel => ({
  id: definition.id,
  apiKey: definition.apiKey,
  label: definition.label,
  kind: definition.kind,
  localized: definition.localized,
  draftAndPublish: definition.draftAndPublish,
});

/** Storage form (field IDs) → API keys, unmasked: hooks are trusted server code. */
const toEntryData = (model: ContentModel, data: Readonly<ContentData> | undefined): EntryData | undefined =>
  data === undefined
    ? undefined
    : projectData(data, {
        model,
        fields: model.definition.fields.filter((field) => !field.deprecated),
        visibleTargets: null,
        populated: new Map(),
        richTextHtml: false,
        mediaAssets: null,
      });

const reject = (message: string, details?: Record<string, unknown>): never => {
  throw new HookError(message, details);
};

const rejected = (name: string, error: HookError) =>
  new AppError(422, 'HOOK_REJECTED', error.message, { hook: name, ...(error.details ?? {}) });

const runBeforeHooks = async (
  environment: HookEnvironment,
  event: BeforeEvent,
  context: LifecycleContext,
) => {
  const matched = matchHooks(environment.hooks, context.model.definition, event);
  if (matched.length === 0) {
    return;
  }
  const shared = {
    event,
    model: toHookModel(context.model.definition),
    entry: { id: context.entryId, locale: context.locale, state: ENTRY_STATE_BY_EVENT[event] },
    locale: context.locale,
    data: toEntryData(context.model, context.data),
    before: toEntryData(context.model, context.before),
    principal: context.actor,
    trx: context.trx,
    services: environment.services,
    signal: environment.signal,
    reject,
  };
  for (const { name, hook } of matched) {
    try {
      await hook({ ...shared, logger: environment.logger.child({ hook: name }) });
    } catch (error) {
      throw isHookError(error) ? rejected(name, error) : error;
    }
  }
};

/** What the outbox event carries for the post-commit run (kept out of job payloads, which admins can see). */
export type AfterHookEventPayload = {
  event: AfterEvent;
  model: HookModel;
  entry: HookEntry;
  data: EntryData | null;
  before: EntryData | null;
  principal: Principal;
};

const recordAfterHookPoint = async (
  environment: HookEnvironment,
  event: AfterEvent,
  context: LifecycleContext,
) => {
  if (matchHooks(environment.hooks, context.model.definition, event).length === 0) {
    return;
  }
  const payload: AfterHookEventPayload = {
    event,
    model: toHookModel(context.model.definition),
    entry: { id: context.entryId, locale: context.locale, state: ENTRY_STATE_BY_EVENT[event] },
    data: toEntryData(context.model, context.data) ?? null,
    before: toEntryData(context.model, context.before) ?? null,
    principal: context.actor,
  };
  await writeOutboxEvent(context.trx, {
    type: EXTENSION_HOOK_EVENT,
    aggregateType: 'entry',
    aggregateId: context.entryId,
    payload,
  });
};

/** Registers the project's hooks on the content hook engine. */
export const registerProjectHooks = (engine: ContentHooks, environment: HookEnvironment) => {
  for (const event of BEFORE_EVENTS) {
    engine.on(event, (context) => runBeforeHooks(environment, event, context));
  }
  for (const event of AFTER_EVENTS) {
    engine.on(event, (context) => recordAfterHookPoint(environment, event, context));
  }
};

/** Relay subscriber: one job per matching `after*` hook, idempotent per (event ID, hook name). */
export const createAfterHookSubscriber =
  (hooks: Readonly<Record<string, ModelHooks>>): OutboxSubscriber =>
  async (event, trx) => {
    if (event.type !== EXTENSION_HOOK_EVENT) {
      return;
    }
    const payload = event.payload as AfterHookEventPayload;
    for (const { name } of matchHooks(hooks, payload.model, payload.event)) {
      await enqueueJob(
        {
          type: AFTER_HOOK_JOB,
          payload: { eventId: event.event_id, hook: name, entryId: payload.entry.id },
          idempotencyKey: `${AFTER_HOOK_JOB}:${event.event_id}:${name}`,
        },
        trx,
      );
    }
  };

type AfterHookJobPayload = { eventId: string; hook: string };

/** Runs one `after*` hook in a transaction that also records the run (skipped if it already ran). */
export const createAfterHookJobHandler =
  (environment: HookEnvironment): JobHandler =>
  async (job) => {
    const { eventId, hook: name } = job.payload as AfterHookJobPayload;
    const event = await outboxEventsRepository.findByEventId(eventId, environment.db);
    if (!event) {
      throw new PermanentJobError(`Outbox event ${eventId} not found`);
    }
    const payload = event.payload as AfterHookEventPayload;
    const matched = matchHooks(environment.hooks, payload.model, payload.event).find(
      (candidate) => candidate.name === name,
    );
    if (!matched) {
      job.log.warn({ hook: name }, 'after hook no longer configured; skipped');
      return { skipped: 'not configured' };
    }
    return environment.db.transaction().execute(async (trx) => {
      if (!(await extensionHookRunsRepository.claim({ eventId, hook: name, jobId: job.id }, trx))) {
        job.log.info({ hook: name }, 'after hook already ran for this event; skipped');
        return { skipped: 'already ran' };
      }
      await matched.hook({
        event: payload.event,
        model: payload.model,
        entry: payload.entry,
        locale: payload.entry.locale,
        data: payload.data ?? undefined,
        before: payload.before ?? undefined,
        principal: payload.principal,
        trx,
        services: environment.services,
        logger: job.log.child({ hook: name }),
        signal: job.signal,
        eventId,
        idempotencyKey: `${eventId}:${name}`,
        attempt: job.attempt,
      });
      return { ran: name };
    });
  };
