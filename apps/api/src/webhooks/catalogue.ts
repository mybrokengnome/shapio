import { MEDIA_EVENTS } from '../constants/media.js';
import { CHANGE_SET_EVENTS, DEPLOYMENT_EVENTS } from '../constants/publishing.js';

/**
 * Every event a webhook can subscribe to, as written to the outbox by the services that cause them. A
 * webhook subscribes to exact names or to a whole group with `group.*`.
 */
export type WebhookEventType = { type: string; group: string };

const group = (name: string, types: readonly string[]): WebhookEventType[] =>
  types.map((type) => ({ type, group: name }));

export const WEBHOOK_EVENT_CATALOGUE: readonly WebhookEventType[] = [
  ...group('entry', [
    'entry.created',
    'entry.updated',
    'entry.deleted',
    'entry.published',
    'entry.unpublished',
    'entry.restored',
  ]),
  ...group('media', Object.values(MEDIA_EVENTS)),
  ...group('schema', ['schema.activated', 'schema.deleted']),
  ...group('locale', ['locale.added', 'locale.metadata', 'locale.defaultChanged', 'locale.removed']),
  ...group('change_set', Object.values(CHANGE_SET_EVENTS)),
  ...group('deployment', Object.values(DEPLOYMENT_EVENTS)),
];

/** Sent by "Send test"; never produced by the outbox. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

const TYPES = new Set(WEBHOOK_EVENT_CATALOGUE.map((event) => event.type));
const GROUPS = new Set(WEBHOOK_EVENT_CATALOGUE.map((event) => event.group));

export const isValidEventPattern = (pattern: string): boolean =>
  TYPES.has(pattern) || (pattern.endsWith('.*') && GROUPS.has(pattern.slice(0, -2)));

export const matchesEvent = (patterns: readonly string[], type: string): boolean =>
  patterns.some(
    (pattern) => pattern === type || (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1))),
  );
