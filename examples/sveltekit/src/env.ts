import { defineEnvVars } from '@sveltejs/kit/env';

/** An unset or empty variable reads as undefined; src/lib/server/config.ts applies defaults and checks. */
const optional = (value: string | undefined) => (value === '' ? undefined : value);

/**
 * The build's settings, from the environment or `.env` (which `npm run seed` writes); server-only
 * (`$app/env/private`), read when prerendering runs. src/lib/server/config.ts documents each one.
 */
export const variables = defineEnvVars({
  SHAPIO_URL: { schema: optional },
  SHAPIO_DELIVERY_TOKEN: { schema: optional },
  SHAPIO_DEV_DELIVERY_TOKEN: { schema: optional },
  SHAPIO_DRAFTS: { schema: optional },
  SHAPIO_SNAPSHOT: { schema: optional },
  SHAPIO_SITE: { schema: optional },
  PUBLIC_SHAPIO_URL: { schema: optional },
  SITE_URL: { schema: optional },
});
