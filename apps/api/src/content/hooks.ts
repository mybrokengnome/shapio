import type { Transaction } from 'kysely';
import type { ContentData } from '../db/contentData.js';
import type { DB } from '../db/types.js';
import type { Principal } from '../permissions/types.js';
import type { ContentModel } from './model.js';

/**
 * Lifecycle hook points (ADR 0009). The content services call every hook point inside the owning
 * transaction; a hook that throws aborts the write. This registry is the engine only: the extension
 * runtime (extensions/hooks.ts) registers project hooks on it, running `before*` hooks right here in the
 * transaction and turning `after*` hook points into an outbox event, so project `after*` hooks run after
 * commit as jobs and can never roll the write back.
 */
export const BEFORE_EVENTS = ['beforeCreate', 'beforeUpdate', 'beforePublish', 'beforeDelete'] as const;
export const AFTER_EVENTS = ['afterCreate', 'afterUpdate', 'afterPublish', 'afterDelete'] as const;
export const LIFECYCLE_EVENTS = [...BEFORE_EVENTS, ...AFTER_EVENTS] as const;

export type BeforeEvent = (typeof BEFORE_EVENTS)[number];
export type AfterEvent = (typeof AFTER_EVENTS)[number];
export type LifecycleEvent = BeforeEvent | AfterEvent;

/** The state of the entry the hook is about: its draft, its published head, or a deleted entry. */
export type LifecycleEntryState = 'draft' | 'published' | 'deleted';

export type LifecycleContext = {
  trx: Transaction<DB>;
  model: ContentModel;
  entryId: string;
  locale: string | null;
  /** The document in storage form (keyed by field IDs); absent for deletes. */
  data?: Readonly<ContentData>;
  /** The document before the change (the previous draft, or the live version being replaced). */
  before?: Readonly<ContentData>;
  actor: Principal;
};

export type LifecycleHook = (context: LifecycleContext) => Promise<void> | void;

export type ContentHooks = {
  on: (event: LifecycleEvent, hook: LifecycleHook) => () => void;
  run: (event: LifecycleEvent, context: LifecycleContext) => Promise<void>;
};

export const ENTRY_STATE_BY_EVENT: Readonly<Record<LifecycleEvent, LifecycleEntryState>> = {
  beforeCreate: 'draft',
  afterCreate: 'draft',
  beforeUpdate: 'draft',
  afterUpdate: 'draft',
  beforePublish: 'published',
  afterPublish: 'published',
  beforeDelete: 'deleted',
  afterDelete: 'deleted',
};

export const createContentHooks = (): ContentHooks => {
  const hooks = new Map<LifecycleEvent, LifecycleHook[]>();
  return {
    on: (event, hook) => {
      hooks.set(event, [...(hooks.get(event) ?? []), hook]);
      return () =>
        hooks.set(
          event,
          (hooks.get(event) ?? []).filter((candidate) => candidate !== hook),
        );
    },
    run: async (event, context) => {
      for (const hook of hooks.get(event) ?? []) {
        await hook(context);
      }
    },
  };
};
