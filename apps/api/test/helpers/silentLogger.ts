import { pino } from 'pino';

/** A real pino logger that writes nowhere; for code under test that needs a logger. */
export const silentLogger = pino({ level: 'silent' });
