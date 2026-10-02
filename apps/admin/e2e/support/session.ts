import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { NEW_PASSWORD, OWNER } from './accounts';
import { E2E_BASE_PATH, E2E_ORIGIN } from './constants';

export const ADMIN_API = `${E2E_ORIGIN}${E2E_BASE_PATH}/api/admin`;

/**
 * Signs the page's browser context in as the owner through the API, whichever spec ran before: completes
 * first-run setup when it is still pending, otherwise logs in with the owner's current password (the
 * admin spec changes it near its end).
 */
export const signInAsOwner = async (page: Page) => {
  const request = page.request;
  const status = (await (await request.get(`${ADMIN_API}/setup`)).json()) as { required: boolean };
  if (status.required) {
    const response = await request.post(`${ADMIN_API}/setup`, {
      data: { name: OWNER.name, email: OWNER.email, password: OWNER.password },
    });
    expect(response.ok()).toBe(true);
    return;
  }
  const attempts: string[] = [];
  for (const password of [NEW_PASSWORD, OWNER.password]) {
    const response = await request.post(`${ADMIN_API}/auth/login`, {
      data: { email: OWNER.email, password },
    });
    if (response.ok()) {
      return;
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
