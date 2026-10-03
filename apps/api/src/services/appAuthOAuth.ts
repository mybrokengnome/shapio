import type { Transaction } from 'kysely';
import {
  codeChallengeOf,
  newOAuthState,
  openOAuthState,
  sealOAuthState,
  type OAuthState,
} from '../appAuth/oauth/state.js';
import { OAuthProviderError, type OAuthProfile } from '../appAuth/oauth/types.js';
import type { AppAuthRuntime } from '../appAuth/runtime.js';
import { OAUTH_LOGIN_CODE_TTL_MS, OAUTH_STATE_TTL_MS } from '../constants/appAuth.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { isUniqueViolation } from '../helpers/pgErrors.js';
import { generateToken, hashToken, safeEqual } from '../helpers/tokens.js';
import * as appLoginCodesRepository from '../repositories/appLoginCodes.js';
import * as appOAuthAccountsRepository from '../repositories/appOAuthAccounts.js';
import * as appUsersRepository from '../repositories/appUsers.js';
import type { AppUserRow } from '../repositories/appUsers.js';
import type { ActorContext, ClientInfo, SiteActorContext } from './actorContext.js';
import { normalizeEmail } from './adminUsers.js';
import { endAllSignIns, issueSession, signInStatus, type AppSession } from './appAuthSessions.js';
import { recordAudit } from './audit.js';

/**
 * Sign in with Google or GitHub (build plan §4.I2). The browser goes to the provider and back to Shapio's
 * callback (authorization code + PKCE, state bound to the browser by a signed cookie). Shapio then sends the
 * browser to the app with a one-time code, which the app exchanges for tokens: tokens never travel in a URL.
 *
 * Linking: a known provider identity signs into its account; otherwise a provider-verified email links to
 * the account with that address or creates one. An unverified email never links or creates anything.
 */

export const callbackPath = (provider: string) => `/api/app-auth/oauth/${provider}/callback`;

const providerOf = (runtime: AppAuthRuntime, provider: string) => {
  const configured = runtime.providers.get(provider);
  if (!configured) {
    throw new AppError(404, 'PROVIDER_NOT_CONFIGURED', `Sign-in with "${provider}" is not configured`);
  }
  return configured;
};

/** `value` is `prefix`, or continues it with a path, query or fragment (so `myapp://auth` ≠ `myapp://authx`). */
const startsWithPrefix = (value: string, prefix: string) =>
  value === prefix || (value.startsWith(prefix) && /^[/?#]/.test(value.slice(prefix.length)));

/**
 * The app's page to return to: an http(s) URL on an allowed origin, or a URL under an allowed custom-scheme
 * prefix (APP_AUTH_RETURN_URLS; by default CORS_ORIGINS plus PUBLIC_URL).
 */
const assertRedirectAllowed = (runtime: AppAuthRuntime, redirectTo: string): string => {
  let url: URL;
  try {
    url = new URL(redirectTo);
  } catch {
    throw new AppError(400, 'INVALID_REDIRECT', 'redirectTo must be an absolute URL');
  }
  const { origins, schemePrefixes } = runtime.returnTargets;
  const allowed = /^https?:$/.test(url.protocol)
    ? url.username === '' && origins.has(url.origin)
    : schemePrefixes.some((prefix) => startsWithPrefix(redirectTo, prefix));
  if (!allowed) {
    throw new AppError(
      400,
      'INVALID_REDIRECT',
      'redirectTo is not an allowed return URL (APP_AUTH_RETURN_URLS)',
    );
  }
  url.hash = '';
  return url.toString();
};

export type OAuthStart = { authorizationUrl: string; stateCookie: string; cookieMaxAgeSeconds: number };

/**
 * Starts a sign-in. `appCodeChallenge` is the S256 challenge of a verifier the app keeps (validated by the
 * route schema); the one-time login code is only exchanged together with that verifier.
 */
export const startOAuth = (
  runtime: AppAuthRuntime,
  provider: string,
  input: { redirectTo: string; appCodeChallenge: string },
): OAuthStart => {
  const { adapter, client } = providerOf(runtime, provider);
  const state = newOAuthState(
    provider,
    assertRedirectAllowed(runtime, input.redirectTo),
    input.appCodeChallenge,
    OAUTH_STATE_TTL_MS,
  );
  return {
    authorizationUrl: adapter.authorizationUrl({
      client,
      redirectUri: runtime.urls.absoluteUrl(callbackPath(provider)),
      state: state.state,
      codeChallenge: codeChallengeOf(state.codeVerifier),
    }),
    stateCookie: sealOAuthState(runtime.keys.oauthState, state),
    cookieMaxAgeSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  };
};

/** A sign-in that cannot complete; `code` is passed to the app as `?error=`. */
class OAuthSignInError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OAuthSignInError';
    this.code = code;
  }
}

const withQuery = (base: string, params: Record<string, string>): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const assertUsable = (runtime: AppAuthRuntime, user: AppUserRow) => {
  if (signInStatus(runtime, user) === 'blocked') {
    throw new OAuthSignInError('ACCOUNT_BLOCKED', 'This account is blocked');
  }
};

/** An existing account takes the provider identity. Following the provider's verified email proves it. */
const linkToExisting = async (
  context: ActorContext,
  provider: string,
  profile: OAuthProfile & { email: string },
  user: AppUserRow,
  trx: Transaction<DB>,
) => {
  await appOAuthAccountsRepository.insert(
    { appUserId: user.id, provider, providerUserId: profile.providerUserId, email: profile.email },
    trx,
  );
  if (user.confirmed_at === null) {
    // Pre-hijack defence: whoever registered this unconfirmed address with a password never proved they own
    // it; the provider just proved the caller does. Their password and sign-ins go.
    const now = new Date();
    await appUsersRepository.update(user.id, { confirmed_at: now, password_hash: null }, trx);
    await endAllSignIns(user.id, now, 'oauth_link', trx);
  }
  await recordAudit(trx, {
    ...context,
    actor: { kind: 'appUser', appUserId: user.id, roleIds: [] },
    action: 'app_user.oauth_link',
    target: { type: 'app_user', id: user.id },
    metadata: { provider, wasConfirmed: user.confirmed_at !== null },
  });
  return user.id;
};

const createFromProfile = async (
  context: SiteActorContext,
  provider: string,
  profile: OAuthProfile & { email: string },
  trx: Transaction<DB>,
) => {
  const user = await appUsersRepository.insert(
    {
      site_id: context.site.id,
      email: profile.email,
      name: profile.name.trim(),
      password_hash: null,
      confirmed_at: new Date(),
    },
    trx,
  );
  await appOAuthAccountsRepository.insert(
    { appUserId: user.id, provider, providerUserId: profile.providerUserId, email: profile.email },
    trx,
  );
  await recordAudit(trx, {
    ...context,
    actor: { kind: 'appUser', appUserId: user.id, roleIds: [] },
    action: 'app_user.register',
    target: { type: 'app_user', id: user.id },
    metadata: { method: provider },
  });
  return user.id;
};

/** Finds, links or creates the account for a provider profile; returns its ID. */
const accountFor = async (
  runtime: AppAuthRuntime,
  context: SiteActorContext,
  provider: string,
  profile: OAuthProfile,
  trx: Transaction<DB>,
): Promise<string> => {
  const known = await appOAuthAccountsRepository.findByIdentity(provider, profile.providerUserId, trx);
  if (known) {
    const user = await appUsersRepository.lockById(known.app_user_id, trx);
    if (!user) {
      throw new OAuthSignInError('ACCOUNT_UNAVAILABLE', 'This account no longer exists');
    }
    assertUsable(runtime, user);
    await appOAuthAccountsRepository.updateEmail(known.id, profile.email, trx);
    return user.id;
  }
  if (profile.email === null || !profile.emailVerified) {
    throw new OAuthSignInError(
      'EMAIL_NOT_VERIFIED',
      'The provider account has no verified email address; verify it with the provider and try again',
    );
  }
  const verified = { ...profile, email: normalizeEmail(profile.email) };
  const existing = await appUsersRepository.findByEmailWithHash(verified.email, trx);
  if (existing) {
    const locked = await appUsersRepository.lockById(existing.id, trx);
    if (!locked) {
      throw new OAuthSignInError('TRY_AGAIN', 'The account changed during sign-in; try again');
    }
    assertUsable(runtime, locked);
    return linkToExisting(context, provider, verified, locked, trx);
  }
  return createFromProfile(context, provider, verified, trx);
};

const issueLoginCode = async (
  appUserId: string,
  codeChallenge: string,
  trx: Transaction<DB>,
): Promise<string> => {
  const code = generateToken();
  await appLoginCodesRepository.insert(
    {
      appUserId,
      codeHash: hashToken(code),
      codeChallenge,
      expiresAt: new Date(Date.now() + OAUTH_LOGIN_CODE_TTL_MS),
    },
    trx,
  );
  return code;
};

export type OAuthCallbackInput = {
  provider: string;
  stateCookie: string | undefined;
  query: { code?: string; state?: string; error?: string };
};

/** Where the callback sends the browser: back to the app with `?code=` or `?error=`. */
export type OAuthCallbackResult = { redirectUrl: string };

const completeSignIn = async (
  runtime: AppAuthRuntime,
  context: SiteActorContext,
  provider: string,
  state: OAuthState,
  code: string,
): Promise<string> => {
  const { adapter, client } = providerOf(runtime, provider);
  const profile = await adapter.fetchProfile({
    client,
    redirectUri: runtime.urls.absoluteUrl(callbackPath(provider)),
    code,
    codeVerifier: state.codeVerifier,
  });
  try {
    return await db
      .transaction()
      .execute(async (trx) =>
        issueLoginCode(
          await accountFor(runtime, context, provider, profile, trx),
          state.appCodeChallenge,
          trx,
        ),
      );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Two sign-ins for the same new identity or address raced; the other one won.
      throw new OAuthSignInError('TRY_AGAIN', 'The account changed during sign-in; try again');
    }
    throw error;
  }
};

/**
 * Handles the provider's redirect. Without a valid state cookie nothing is trusted (not even where to send
 * the browser), so that is a 400. Every later failure goes back to the app as `?error=<CODE>`.
 */
export const completeOAuth = async (
  runtime: AppAuthRuntime,
  context: SiteActorContext,
  input: OAuthCallbackInput,
): Promise<OAuthCallbackResult> => {
  providerOf(runtime, input.provider);
  const state = openOAuthState(runtime.keys.oauthState, input.stateCookie, {
    provider: input.provider,
    state: input.query.state ?? '',
  });
  if (!state) {
    throw new AppError(400, 'INVALID_OAUTH_STATE', 'The sign-in expired or was started in another browser');
  }
  if (input.query.error !== undefined || !input.query.code) {
    return { redirectUrl: withQuery(state.redirectTo, { error: 'ACCESS_DENIED' }) };
  }
  try {
    const code = await completeSignIn(runtime, context, input.provider, state, input.query.code);
    return { redirectUrl: withQuery(state.redirectTo, { code }) };
  } catch (error) {
    if (error instanceof OAuthSignInError || error instanceof OAuthProviderError) {
      return { redirectUrl: withQuery(state.redirectTo, { error: error.code }) };
    }
    throw error;
  }
};

type ExchangeOutcome = { kind: 'session'; session: AppSession } | { kind: 'rejected'; error: AppError };

const invalidCode = () =>
  new AppError(400, 'INVALID_OR_EXPIRED_CODE', 'This sign-in code is invalid, expired or already used');

/**
 * Exchanges the one-time code the app received for a session, given the verifier of the challenge the app
 * sent when it started the sign-in. Codes work once, within a minute. A wrong verifier spends the code too
 * (the safer choice: whoever intercepted it gets one attempt, never a retry), so the app starts over.
 */
export const exchangeLoginCode = async (
  runtime: AppAuthRuntime,
  input: { code: string; codeVerifier: string },
  client: ClientInfo,
): Promise<AppSession> => {
  const outcome = await db.transaction().execute(async (trx): Promise<ExchangeOutcome> => {
    const now = new Date();
    const row = await appLoginCodesRepository.lockByCodeHash(hashToken(input.code), trx);
    if (!row || row.used_at !== null || row.expires_at.getTime() <= now.getTime()) {
      return { kind: 'rejected', error: invalidCode() };
    }
    await appLoginCodesRepository.markUsed(row.id, now, trx);
    if (!safeEqual(codeChallengeOf(input.codeVerifier), row.code_challenge)) {
      // Committed with the code marked used.
      return {
        kind: 'rejected',
        error: new AppError(400, 'INVALID_CODE_VERIFIER', 'The code verifier does not match this sign-in'),
      };
    }
    await appUsersRepository.update(row.app_user_id, { last_login_at: now }, trx);
    return { kind: 'session', session: await issueSession(runtime, row.app_user_id, { client }, trx) };
  });
  if (outcome.kind === 'rejected') {
    throw outcome.error;
  }
  return outcome.session;
};
