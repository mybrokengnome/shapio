import type { FastifyBaseLogger } from 'fastify';
import mysql, { type Connection } from 'mysql2';
import { subscribeNotifications } from '../notifyHub.js';
import { mysqlDatabaseKey, mysqlPoolOptions, SESSION_SETUP } from './driver.js';

/**
 * Notifications on MySQL (ADR 0001, "MySQL"; ADR 0002): MySQL has no LISTEN/NOTIFY, so `notify()` inserts a
 * row into `notifications` inside the caller's transaction (it becomes visible when, and only if, that
 * transaction commits) and every listener polls the table on its own connection. Listeners in the
 * publishing process also hear it at once through the in-process bus; the row ID de-duplicates the two.
 *
 * AUTO_INCREMENT IDs can commit out of order, so a poll reads a time window (`WINDOW_SECONDS`, by the row's
 * insert time) rather than "after the last ID", and remembers the IDs it delivered. A notification whose
 * transaction stays open longer than the window can be missed, which consumers tolerate: they also check a
 * durable version, and `onConnect` runs after every (re)connect. Each listener also prunes rows older than
 * `RETENTION_SECONDS`.
 */
const WINDOW_SECONDS = 30;
const RETENTION_SECONDS = 300;
const PRUNE_EVERY_MS = 60_000;

export type MysqlNotificationListenerOptions = {
  connectionString: string;
  channels: readonly string[];
  onNotification: (channel: string, payload: string | undefined) => void;
  onConnect?: () => void;
  log: FastifyBaseLogger;
  applicationName?: string;
  pollMs: number;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
};

type NotificationRow = { id: string; channel: string; payload: string };

const query = <T>(connection: Connection, sql: string, values: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) => {
    connection.query(sql, values, (error, rows) => (error ? reject(error) : resolve(rows as T[])));
  });

export const createMysqlNotificationListener = (options: MysqlNotificationListenerOptions) => {
  const { connectionString, channels, onNotification, onConnect, log } = options;
  /** Delivered IDs with when they were delivered (pruned after the window). */
  const delivered = new Map<string, number>();
  let connection: Connection | undefined;
  let connected = false;
  let closed = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | undefined;
  let lastPrune = 0;

  const deliver = (id: string | undefined, channel: string, payload: string | undefined) => {
    if (closed || !channels.includes(channel)) {
      return;
    }
    if (id !== undefined) {
      if (delivered.has(id)) {
        return;
      }
      delivered.set(id, Date.now());
    }
    onNotification(channel, payload);
  };

  const unsubscribe = subscribeNotifications(mysqlDatabaseKey(connectionString), (channel, payload, id) =>
    deliver(id, channel, payload),
  );

  const forgetOld = () => {
    const cutoff = Date.now() - 2 * WINDOW_SECONDS * 1000;
    for (const [id, at] of delivered) {
      if (at < cutoff) {
        delivered.delete(id);
      }
    }
  };

  const recentRows = (current: Connection) =>
    query<NotificationRow>(
      current,
      `select cast(id as char) as id, channel, payload from notifications
       where created_at >= sysdate(6) - interval ${WINDOW_SECONDS} second and channel in (?)
       order by id`,
      [[...channels]],
    );

  const poll = async (current: Connection) => {
    for (const row of await recentRows(current)) {
      deliver(row.id, row.channel, row.payload);
    }
    forgetOld();
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now();
      await query(
        current,
        `delete from notifications where created_at < sysdate(6) - interval ${RETENTION_SECONDS} second limit 1000`,
      );
    }
  };

  const schedule = (delay: number, fn: () => void) => {
    if (!closed) {
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, delay);
    }
  };

  const dropConnection = (current: Connection, error: unknown) => {
    if (connection !== current) {
      return;
    }
    connection = undefined;
    connected = false;
    log.warn({ err: error }, 'notification listener connection failed; reconnecting');
    current.destroy();
    const delay = Math.min(options.maxReconnectDelayMs, options.reconnectDelayMs * 2 ** attempt);
    attempt += 1;
    schedule(delay, () => void connect());
  };

  const loop = (current: Connection) => {
    schedule(options.pollMs, () => {
      poll(current).then(
        () => loop(current),
        (error: unknown) => dropConnection(current, error),
      );
    });
  };

  const connect = async () => {
    if (closed) {
      return;
    }
    const current = mysql.createConnection(
      mysqlPoolOptions(connectionString, 1, options.applicationName ?? 'shapio-listen'),
    );
    connection = current;
    current.on('error', (error) => dropConnection(current, error));
    try {
      await query(current, SESSION_SETUP);
      // Rows already in the window predate this connection: `onConnect` resynchronises for them.
      for (const row of await recentRows(current)) {
        delivered.set(row.id, Date.now());
      }
      if (closed || connection !== current) {
        current.destroy();
        return;
      }
      connected = true;
      attempt = 0;
      log.debug({ channels }, 'polling for notifications');
      onConnect?.();
      loop(current);
    } catch (error) {
      dropConnection(current, error);
    }
  };

  void connect();

  return {
    isConnected: () => connected,
    close: async () => {
      closed = true;
      clearTimeout(timer);
      timer = undefined;
      unsubscribe();
      const current = connection;
      connection = undefined;
      connected = false;
      current?.destroy();
    },
  };
};
