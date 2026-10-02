import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { generateToken } from '../helpers/tokens.js';
import * as systemSettingsRepository from '../repositories/systemSettings.js';

export const SIGNING_SECRET_SETTING = 'signing_secret';

/**
 * The instance's HMAC signing secret (preview tokens, webhook signatures). SESSION_SECRET always wins.
 * Without it, the secret is generated once and stored in `system_settings`, so it survives restarts and
 * every instance on the database agrees: concurrent first boots race on one insert and all re-read the
 * winner. The value is never logged.
 */
export const resolveSigningSecret = async (
  database: Kysely<DB>,
  configured: string | undefined,
  log: Pick<FastifyBaseLogger, 'info'>,
): Promise<string> => {
  if (configured) {
    return configured;
  }
  const stored = await systemSettingsRepository.findValue(SIGNING_SECRET_SETTING, database);
  if (stored) {
    return stored;
  }
  const created = await systemSettingsRepository.insertIfAbsent(
    SIGNING_SECRET_SETTING,
    generateToken(),
    database,
  );
  const value = await systemSettingsRepository.findValue(SIGNING_SECRET_SETTING, database);
  if (!value) {
    throw new Error('The signing secret could not be stored');
  }
  if (created) {
    log.info('Generated signing secret; set SESSION_SECRET to pin it');
  }
  return value;
};
