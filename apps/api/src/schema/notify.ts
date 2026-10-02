import type { FastifyBaseLogger } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { NOTIFY_CHANNEL } from '../constants/notifyChannels.js';
import { createNotificationListener, notify, type NotificationListener } from '../db/notifications.js';
import type { DB } from '../db/types.js';
import type { SchemaRegistry } from './registry.js';

/** Announces a new global schema version. Call inside the activation transaction: sent on commit only. */
export const publishSchemaChanged = (trx: Kysely<DB> | Transaction<DB>, schemaVersion: number) =>
  notify(trx, NOTIFY_CHANNEL.schemaChanged, String(schemaVersion));

type ListenerOptions = { connectionString: string; registry: SchemaRegistry; log: FastifyBaseLogger };

/**
 * Listens on the schema channel with a dedicated connection that reconnects on failure, and refreshes the
 * registry early. After every (re)connect it refreshes too, covering anything missed while disconnected.
 * Correctness never depends on this: requests still check the durable version.
 */
export const startSchemaChangeListener = ({
  connectionString,
  registry,
  log,
}: ListenerOptions): NotificationListener =>
  createNotificationListener({
    connectionString,
    channels: [NOTIFY_CHANNEL.schemaChanged],
    applicationName: 'shapio-schema-listen',
    log,
    onNotification: (_channel, payload) => {
      const version = Number(payload);
      registry.hint(Number.isInteger(version) ? version : undefined);
    },
    onConnect: () => registry.hint(),
  });
