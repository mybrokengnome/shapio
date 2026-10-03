import { EventEmitter } from 'node:events';

/**
 * LISTEN/NOTIFY for SQLite: an in-process event bus per database file (ADR 0002 notes notifications are
 * an optimisation; consumers also check a durable version). Every handle on the same file in this process
 * shares one bus, so two app instances in one test process still hear each other. Other processes never
 * do: SQLite deployments are single-process.
 */
const HUBS = new Map<string, EventEmitter>();

const hubFor = (databaseKey: string): EventEmitter => {
  let hub = HUBS.get(databaseKey);
  if (!hub) {
    hub = new EventEmitter();
    hub.setMaxListeners(0);
    HUBS.set(databaseKey, hub);
  }
  return hub;
};

export type NotificationHandler = (channel: string, payload: string | undefined) => void;

/** Delivers on a later turn of the event loop, like a notification arriving from the network. */
export const publishNotification = (databaseKey: string, channel: string, payload: string): void => {
  setImmediate(() => hubFor(databaseKey).emit('notification', channel, payload));
};

/** Subscribes to every channel of the database; returns the unsubscribe function. */
export const subscribeNotifications = (databaseKey: string, handler: NotificationHandler): (() => void) => {
  const hub = hubFor(databaseKey);
  hub.on('notification', handler);
  return () => {
    hub.off('notification', handler);
    if (hub.listenerCount('notification') === 0) {
      HUBS.delete(databaseKey);
    }
  };
};
