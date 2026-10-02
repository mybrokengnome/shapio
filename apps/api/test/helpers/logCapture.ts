import { Writable } from 'node:stream';
import { pino, type Logger } from 'pino';
import { LOG_SERIALIZERS, REDACT_PATHS } from '../../src/logger.js';

export type LogCapture = { logger: Logger; lines: string[]; text: () => string };

/** A real pino logger with Shapio's redaction and serializers, writing every line (trace and up) into memory. */
export const createLogCapture = (): LogCapture => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino(
    { level: 'trace', redact: { paths: REDACT_PATHS, censor: '[redacted]' }, serializers: LOG_SERIALIZERS },
    stream,
  );
  return { logger, lines, text: () => lines.join('') };
};
