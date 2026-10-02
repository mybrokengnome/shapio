import type { FieldReadRow, TokenReadRow, UsageSelection } from '../repositories/usage.js';
import { usageDayOf } from './keys.js';

/**
 * In-memory usage counters (plan developer-face §5). Delivery reads add to a map; nothing touches the
 * database on the request path. Every `flushIntervalMs`, when the map reaches `maxKeys` distinct keys, and
 * on close, the counters are swapped out and written as multi-row upserts (repositories/usage.ts), so
 * instances add up their counts. Counts are best effort: a failed write is logged and its counters are
 * kept for the next flush while there is room, and dropped (with an error log) when there is not.
 */
export type FieldRead = { path: string; selection: UsageSelection };

export type UsageRecorder = {
  /** One request by `principalKey` read these fields of `modelId`. */
  recordFieldReads: (principalKey: string, modelId: string, fields: readonly FieldRead[]) => void;
  /** One delivery request by `principalKey`; `snapshot` when it pinned `?snapshot=N`. */
  recordRequest: (principalKey: string, snapshot: number | null) => void;
};

export type UsageBatch = { fieldReads: FieldReadRow[]; tokenReads: TokenReadRow[] };

/** A recorder whose counters can be written on demand (the app's `usage` decoration). */
export type UsageTracker = UsageRecorder & {
  /** Writes the current counters now (waits for a flush already running first). */
  flush: () => Promise<void>;
};

export type UsageAggregator = UsageTracker & {
  /** Stops the timer and writes what is left. */
  close: () => Promise<void>;
  /** Distinct keys held in memory. */
  size: () => number;
};

type UsageLog = {
  error: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
};

export type UsageAggregatorOptions = {
  write: (batch: UsageBatch) => Promise<void>;
  flushIntervalMs: number;
  maxKeys?: number;
  log: UsageLog;
  now?: () => Date;
};

export const USAGE_MAX_KEYS = 50_000;

const SEPARATOR = '\u0000';

type Counters = {
  fields: Map<string, FieldReadRow>;
  tokens: Map<string, TokenReadRow>;
};

const emptyCounters = (): Counters => ({ fields: new Map(), tokens: new Map() });

const countersSize = (counters: Counters) => counters.fields.size + counters.tokens.size;

const addFieldRow = (counters: Counters, row: FieldReadRow) => {
  const key = [row.day, row.modelId, row.fieldPath, row.principalKey, row.selection].join(SEPARATOR);
  const known = counters.fields.get(key);
  if (!known) {
    counters.fields.set(key, { ...row });
    return;
  }
  known.reads += row.reads;
  known.lastReadAt = row.lastReadAt > known.lastReadAt ? row.lastReadAt : known.lastReadAt;
};

const addTokenRow = (counters: Counters, row: TokenReadRow) => {
  const key = [row.day, row.principalKey].join(SEPARATOR);
  const known = counters.tokens.get(key);
  if (!known) {
    counters.tokens.set(key, { ...row });
    return;
  }
  known.requests += row.requests;
  if (row.lastReadAt >= known.lastReadAt) {
    known.lastReadAt = row.lastReadAt;
    known.lastSnapshot = row.lastSnapshot ?? known.lastSnapshot;
  } else {
    known.lastSnapshot ??= row.lastSnapshot;
  }
};

export const createUsageAggregator = ({
  write,
  flushIntervalMs,
  maxKeys = USAGE_MAX_KEYS,
  log,
  now = () => new Date(),
}: UsageAggregatorOptions): UsageAggregator => {
  let counters = emptyCounters();
  let running: Promise<void> = Promise.resolve();
  let closed = false;
  // An early flush is queued and has not swapped the counters out yet.
  let earlyFlushQueued = false;

  const writeOut = async () => {
    earlyFlushQueued = false;
    const batch = counters;
    counters = emptyCounters();
    if (countersSize(batch) === 0) {
      return;
    }
    try {
      await write({ fieldReads: [...batch.fields.values()], tokenReads: [...batch.tokens.values()] });
    } catch (error) {
      if (!closed && countersSize(batch) + countersSize(counters) <= maxKeys) {
        log.warn(
          { err: error, keys: countersSize(batch) },
          'usage flush failed; keeping counters for the next one',
        );
        batch.fields.forEach((row) => addFieldRow(counters, row));
        batch.tokens.forEach((row) => addTokenRow(counters, row));
        return;
      }
      log.error({ err: error, keys: countersSize(batch) }, 'usage flush failed; dropping these counters');
    }
  };

  // Flushes run one after another, so a slow write never overlaps the next.
  const flush = () => {
    running = running.then(writeOut);
    return running;
  };

  const flushInBackground = () => {
    // writeOut logs its own failures; this only keeps the promise from being unhandled.
    flush().catch(() => undefined);
  };

  const timer = setInterval(flushInBackground, flushIntervalMs);
  timer.unref();

  const checkCapacity = () => {
    if (!earlyFlushQueued && countersSize(counters) >= maxKeys) {
      earlyFlushQueued = true;
      flushInBackground();
    }
  };

  return {
    recordFieldReads: (principalKey, modelId, fields) => {
      const at = now();
      const day = usageDayOf(at);
      for (const field of fields) {
        addFieldRow(counters, {
          day,
          modelId,
          fieldPath: field.path,
          principalKey,
          selection: field.selection,
          reads: 1,
          lastReadAt: at,
        });
      }
      checkCapacity();
    },
    recordRequest: (principalKey, snapshot) => {
      const at = now();
      addTokenRow(counters, {
        day: usageDayOf(at),
        principalKey,
        requests: 1,
        lastSnapshot: snapshot,
        lastReadAt: at,
      });
      checkCapacity();
    },
    flush,
    close: async () => {
      clearInterval(timer);
      closed = true;
      await flush();
    },
    size: () => countersSize(counters),
  };
};

/** A tracker that counts nothing (USAGE_TRACKING=false). */
export const NOOP_USAGE_TRACKER: UsageTracker = {
  recordFieldReads: () => undefined,
  recordRequest: () => undefined,
  flush: () => Promise.resolve(),
};
