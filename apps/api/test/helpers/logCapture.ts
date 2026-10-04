import { Writable } from 'node:stream';
import { pino, type Level, type Logger } from 'pino';
import { LOG_SERIALIZERS, REDACT_PATHS } from '../../src/logger.js';

export type LogCapture = { logger: Logger; lines: string[]; text: () => string };

/**
 * A real pino logger with Shapio's redaction and serializers, writing every line at `level` and up (default
 * trace: every line) into memory.
 */
export const createLogCapture = (level: Level = 'trace'): LogCapture => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino(
    { level, redact: { paths: REDACT_PATHS, censor: '[redacted]' }, serializers: LOG_SERIALIZERS },
    stream,
  );
  return { logger, lines, text: () => lines.join('') };
};
