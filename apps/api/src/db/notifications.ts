import type { FastifyBaseLogger } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import pg from 'pg';
import { dialectOfUrl, isSqlite, sqliteLocationOfUrl } from './dialect.js';
import { notificationKeyOf } from './sqlite/driver.js';
import { subscribeNotifications } from './sqlite/notifyHub.js';
import type { DB } from './types.js';

/**
 * LISTEN/NOTIFY primitives (ADR 0002). Notifications are an optimisation only: a listener can miss
 * messages while disconnected, so every consumer must also check a durable version. Callers get an
 * `onConnect` callback after every (re)connect to resynchronise for anything missed in between.
 *
 * SQLite: `shapio_notify()` queues on the connection and an in-process bus delivers on commit
 * (`sqlite/notifyHub.ts`); only listeners in the same process hear it.
 */

/** Sends a notification. Inside a transaction it is delivered only if (and when) that transaction commits. */
export const notify = async (
  executor: Kysely<DB> | Transaction<DB>,
  channel: string,
  payload: string,
): Promise<void> => {
  if (isSqlite()) {
    await sql`select shapio_notify(${channel}, ${payload})`.execute(executor);
    return;
  }
  await sql`select pg_notify(${channel}, ${payload})`.execute(executor);
};

export type NotificationListener = {
  /** Stops listening and closes the connection; no reconnect afterwards. */
  close: () => Promise<void>;
  isConnected: () => boolean;
};

export type NotificationListenerOptions = {
  connectionString: string;
  channels: readonly string[];
  onNotification: (channel: string, payload: string | undefined) => void;
  /** Runs after the first connect and after every reconnect. */
  onConnect?: () => void;
  log: FastifyBaseLogger;
  applicationName?: string;
  /** First reconnect delay; doubles up to `maxReconnectDelayMs`. */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
};

/** SQLite: a subscription to the in-process bus of the database file; connected until closed. */
const createSqliteNotificationListener = (options: NotificationListenerOptions): NotificationListener => {
  const { channels, onNotification, onConnect } = options;
  let closed = false;
  const unsubscribe = subscribeNotifications(
    notificationKeyOf(sqliteLocationOfUrl(options.connectionString)),
    (channel, payload) => {
      if (!closed && channels.includes(channel)) {
        onNotification(channel, payload);
      }
    },
  );
  setImmediate(() => {
    if (!closed) {
      onConnect?.();
    }
  });
  return {
    isConnected: () => !closed,
    close: async () => {
      closed = true;
      unsubscribe();
    },
  };
};

/** A dedicated connection (not from the pool: pooled connections must not hold LISTEN state). */
export const createNotificationListener = (options: NotificationListenerOptions): NotificationListener => {
  if (dialectOfUrl(options.connectionString) === 'sqlite') {
    return createSqliteNotificationListener(options);
  }
  const {
    connectionString,
    channels,
    onNotification,
    onConnect,
    log,
    applicationName = 'shapio-listen',
    reconnectDelayMs = 100,
    maxReconnectDelayMs = 5000,
  } = options;
  let client: pg.Client | undefined;
  let connected = false;
  let closed = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | undefined;

  const scheduleReconnect = () => {
    if (closed || timer) {
      return;
    }
    const delay = Math.min(maxReconnectDelayMs, reconnectDelayMs * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, delay);
  };

  const dropClient = (current: pg.Client) => {
    if (client !== current) {
      return;
    }
    client = undefined;
    connected = false;
    current.removeAllListeners();
    // Swallow late errors from a dead socket; the reconnect below replaces it.
    current.on('error', () => undefined);
    current.end().catch(() => undefined);
    scheduleReconnect();
  };

  const connect = async () => {
    if (closed) {
      return;
    }
    const current = new pg.Client({ connectionString, application_name: applicationName });
    client = current;
    current.on('notification', (message) => onNotification(message.channel, message.payload));
    current.on('error', (error) => {
      log.warn({ err: error }, 'notification listener connection failed; reconnecting');
      dropClient(current);
    });
    current.on('end', () => {
      if (!closed) {
        log.warn('notification listener connection ended; reconnecting');
        dropClient(current);
      }
    });
    try {
      await current.connect();
      for (const channel of channels) {
        await current.query(`listen ${pg.escapeIdentifier(channel)}`);
      }
      if (closed || client !== current) {
        await current.end().catch(() => undefined);
        return;
      }
      connected = true;
      attempt = 0;
      log.debug({ channels }, 'listening for notifications');
      onConnect?.();
    } catch (error) {
      log.warn({ err: error }, 'notification listener could not connect; retrying');
      dropClient(current);
    }
  };

  void connect();

  return {
    isConnected: () => connected,
    close: async () => {
      closed = true;
      clearTimeout(timer);
      timer = undefined;
      const current = client;
      client = undefined;
      connected = false;
      if (current) {
        current.removeAllListeners();
        current.on('error', () => undefined);
        await current.end().catch(() => undefined);
      }
    },
  };
};
