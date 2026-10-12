import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { NEW_PASSWORD, OWNER } from './accounts';
import { ARTIFACTS_DIR, E2E_BASE_PATH, E2E_ORIGIN } from './constants';

export const ADMIN_API = `${E2E_ORIGIN}${E2E_BASE_PATH}/api/admin`;

/**
 * The owner password that last signed in, kept in the run's files (worker processes come and go). Trying it
 * first keeps failed sign-ins to one per password change: the server locks an account out after five failures
 * from one IP, and a CI shard without admin4Auth.spec.ts never sets NEW_PASSWORD. With no file yet, the owner
 * came from admin1Setup.spec.ts's setup screen, so it still has OWNER.password.
 */
const OWNER_PASSWORD_FILE = join(ARTIFACTS_DIR, 'owner-password.txt');

const passwordsToTry = (): string[] => {
  const known = existsSync(OWNER_PASSWORD_FILE) ? readFileSync(OWNER_PASSWORD_FILE, 'utf8') : OWNER.password;
  return [known, ...[NEW_PASSWORD, OWNER.password].filter((password) => password !== known)];
};

/**
 * Signs the page's browser context in as the owner through the API, whichever spec ran before: completes
 * first-run setup when it is still pending, otherwise logs in with the owner's current password (the
 * admin spec changes it near its end). Returns the password that worked.
 */
export const signInAsOwner = async (page: Page): Promise<string> => {
  const request = page.request;
  const status = (await (await request.get(`${ADMIN_API}/setup`)).json()) as { required: boolean };
  if (status.required) {
    const response = await request.post(`${ADMIN_API}/setup`, {
      data: { name: OWNER.name, email: OWNER.email, password: OWNER.password },
    });
    expect(response.ok()).toBe(true);
    writeFileSync(OWNER_PASSWORD_FILE, OWNER.password);
    return OWNER.password;
  }
  const attempts: string[] = [];
  for (const password of passwordsToTry()) {
    const response = await request.post(`${ADMIN_API}/auth/login`, {
      data: { email: OWNER.email, password },
    });
    if (response.ok()) {
      writeFileSync(OWNER_PASSWORD_FILE, password);
      return password;
    }
    const label = password === NEW_PASSWORD ? 'NEW_PASSWORD' : 'OWNER.password';
    attempts.push(`${label}: HTTP ${response.status()} ${(await response.text()).slice(0, 500)}`);
  }
  // Which spec changed the password (or skipped changing it back) shows in these answers: a 401 means
  // neither known password is current, a 429 that sign-in is rate limited, a 5xx that the server broke.
  throw new Error(
    `Could not sign in as the owner (${OWNER.email}) with either known password:\n${attempts.join('\n')}`,
  );
};

/** Calls a cookie-authenticated admin endpoint with the session's CSRF token. */
export const adminRequest = async (
  request: APIRequestContext,
  method: 'PUT' | 'POST' | 'DELETE',
  path: string,
  data?: unknown,
) => {
  const { csrfToken } = (await (await request.get(`${ADMIN_API}/auth/csrf`)).json()) as { csrfToken: string };
  const response = await request.fetch(`${ADMIN_API}${path}`, {
    method,
    headers: { 'x-csrf-token': csrfToken },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response;
};
