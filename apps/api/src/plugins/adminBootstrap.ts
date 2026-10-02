import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Database } from '../db/index.js';
import { warmUpPasswordHashing } from '../helpers/password.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { ensureSystemRoles } from '../permissions/seedRoles.js';
import { isSetupRequired, issueSetupToken } from '../services/setup.js';

const BANNER_RULE = '='.repeat(72);

/** A multi-line banner, so the one-time token stands out in a busy boot log. */
const setupTokenBanner = (setupUrl: string, token: string) =>
  [
    '',
    BANNER_RULE,
    `No admin account exists yet. Open ${setupUrl} and enter this one-time setup token`,
    '(or run `shapio admin create`):',
    '',
    `  One-time setup token: ${token}`,
    '',
    BANNER_RULE,
    '',
  ].join('\n');

type AdminBootstrapOptions = { db: Database; urls: UrlBuilder; requireSetupToken: boolean };

/**
 * Startup work for admin identity: make sure the built-in roles exist, prepare the dummy password hash,
 * and, while no admin exists, say how to create the owner in the log.
 *
 * By default the first person to open the Setup screen creates the owner, so the line only points there.
 * With SETUP_REQUIRE_TOKEN, a one-time setup token is issued instead: it is written to the log exactly
 * once, in the message text of a banner that stands out in the boot log, and stored only as a hash.
 * Restarting issues a new token and invalidates the old one. `shapio admin create` is the alternative
 * either way.
 */
export const adminBootstrapPlugin = fp<AdminBootstrapOptions>(
  async (app: FastifyInstance, { db, urls, requireSetupToken }) => {
    app.addHook('onReady', async () => {
      await ensureSystemRoles(db);
      await warmUpPasswordHashing();
      if (!requireSetupToken) {
        if (await isSetupRequired(db)) {
          app.log.warn(
            `No admin account yet. Open ${urls.absoluteUrl('/admin/')} to create the owner account.`,
          );
        }
        return;
      }
      const token = await issueSetupToken(db);
      if (token) {
        app.log.warn(setupTokenBanner(urls.absoluteUrl('/admin/setup'), token));
      }
    });
  },
  { name: 'shapio-admin-bootstrap' },
);
