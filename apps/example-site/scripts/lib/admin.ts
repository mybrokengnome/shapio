import { createClient, type ShapioClient } from '@shapio/client';

/**
 * How the seed talks to Shapio's admin API: with SHAPIO_TOKEN (an admin API token), or with
 * SHAPIO_ADMIN_EMAIL + SHAPIO_ADMIN_PASSWORD, in which case it signs in, creates a one-hour admin API token
 * for itself (the schema CLI needs a bearer token) and revokes it when done.
 */
export type AdminConnection = {
  url: string;
  token: string;
  client: ShapioClient;
  /** A signed-in admin session (email and password only): preview tokens are issued to people, not API tokens. */
  session: ShapioClient | undefined;
  close: () => Promise<void>;
};

const SESSION_COOKIE = 'shapio_session';
const SEED_TOKEN_TTL_MS = 60 * 60 * 1000;

const signIn = async (url: string, email: string, password: string) => {
  const response = await fetch(`${url.replace(/\/+$/, '')}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Signing in as ${email} failed: HTTP ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  const { csrfToken } = (await response.json()) as { csrfToken: string };
  if (!cookie) {
    throw new Error('Signing in returned no session cookie');
  }
  return createClient({
    baseUrl: url,
    headers: () => ({ cookie: cookie.split(';')[0] ?? '', 'x-csrf-token': csrfToken }),
  });
};

export const connectAdmin = async (env: NodeJS.ProcessEnv): Promise<AdminConnection> => {
  const url = env.SHAPIO_URL ?? 'http://localhost:4300';
  if (env.SHAPIO_TOKEN) {
    return {
      url,
      token: env.SHAPIO_TOKEN,
      client: createClient({ baseUrl: url, token: env.SHAPIO_TOKEN }),
      session: undefined,
      close: async () => undefined,
    };
  }
  const email = env.SHAPIO_ADMIN_EMAIL;
  const password = env.SHAPIO_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set SHAPIO_TOKEN (an admin API token), or SHAPIO_ADMIN_EMAIL and SHAPIO_ADMIN_PASSWORD');
  }
  const session = await signIn(url, email, password);
  const roles = await session.admin.roles.list();
  const admin = roles.find((role) => role.key === 'admin');
  if (!admin) {
    throw new Error('The built-in admin role is missing');
  }
  const created = await session.admin.tokens.create({
    name: 'example-site seed (temporary)',
    roleId: admin.id,
    expiresAt: new Date(Date.now() + SEED_TOKEN_TTL_MS).toISOString(),
  });
  return {
    url,
    token: created.token,
    client: createClient({ baseUrl: url, token: created.token }),
    session,
    close: () => session.admin.tokens.revoke(created.apiToken.id),
  };
};
