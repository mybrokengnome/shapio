import type { RequestFn } from '../request.js';
import type {
  AppChangePasswordInput,
  AppLoginInput,
  AppOAuthProvider,
  AppRegisterInput,
  AppRegisterResult,
  AppSession,
  AppUser,
} from './types.js';

export const APP_AUTH_PATHS = {
  register: '/api/app-auth/register',
  login: '/api/app-auth/login',
  refresh: '/api/app-auth/refresh',
  logout: '/api/app-auth/logout',
  me: '/api/app-auth/me',
  password: '/api/app-auth/me/password',
  confirmEmail: '/api/app-auth/confirm-email',
  resendConfirmation: '/api/app-auth/confirm-email/resend',
  passwordReset: '/api/app-auth/password-reset',
  passwordResetConfirm: '/api/app-auth/password-reset/confirm',
  providers: '/api/app-auth/providers',
  oauthExchange: '/api/app-auth/oauth/exchange',
} as const;

/**
 * App-user endpoints. Calls that act as the signed-in user need a client created with `token: accessToken`.
 * `baseUrl` is the client's base URL, used to build the OAuth start link the browser navigates to.
 */
export const createAppAuthApi = (request: RequestFn, baseUrl: string) => ({
  register: (body: AppRegisterInput) =>
    request<AppRegisterResult>(APP_AUTH_PATHS.register, { method: 'POST', body }),
  login: (body: AppLoginInput) => request<AppSession>(APP_AUTH_PATHS.login, { method: 'POST', body }),
  refresh: (refreshToken: string) =>
    request<AppSession>(APP_AUTH_PATHS.refresh, { method: 'POST', body: { refreshToken } }),
  /**
   * Signs the account out everywhere: this login's refresh tokens are revoked, and every access token the
   * account holds (on any device) is refused from the next request. Other logins recover with their own
   * refresh token.
   */
  logout: (refreshToken: string) =>
    request<void>(APP_AUTH_PATHS.logout, { method: 'POST', body: { refreshToken } }),
  /** The signed-in user. Answers 401 once the account logged out anywhere, changed its password or was blocked. */
  me: () => request<AppUser>(APP_AUTH_PATHS.me),
  updateMe: (body: { name: string }) => request<AppUser>(APP_AUTH_PATHS.me, { method: 'PATCH', body }),
  /** Returns a new session; every other sign-in of the account is revoked. */
  changePassword: (body: AppChangePasswordInput) =>
    request<AppSession>(APP_AUTH_PATHS.password, { method: 'POST', body }),
  deleteMe: (body: { password?: string } = {}) =>
    request<void>(APP_AUTH_PATHS.me, { method: 'DELETE', body }),
  /** The token from the `#token=` fragment of the confirmation link. */
  confirmEmail: (token: string) =>
    request<void>(APP_AUTH_PATHS.confirmEmail, { method: 'POST', body: { token } }),
  resendConfirmation: (email: string) =>
    request<void>(APP_AUTH_PATHS.resendConfirmation, { method: 'POST', body: { email } }),
  requestPasswordReset: (email: string) =>
    request<void>(APP_AUTH_PATHS.passwordReset, { method: 'POST', body: { email } }),
  confirmPasswordReset: (body: { token: string; password: string }) =>
    request<void>(APP_AUTH_PATHS.passwordResetConfirm, { method: 'POST', body }),
  providers: async () =>
    (await request<{ providers: AppOAuthProvider[] }>(APP_AUTH_PATHS.providers)).providers,
  /**
   * Where to send the browser to sign in with a provider. `codeChallenge` comes from `createPkcePair()`;
   * keep its `codeVerifier` until the browser returns. It comes back to `redirectTo` (an allowed return URL,
   * by default an origin listed in CORS_ORIGINS) with `?code=` (pass it to `exchangeCode`) or `?error=`.
   */
  oauthStartUrl: (provider: AppOAuthProvider, redirectTo: string, codeChallenge: string) =>
    `${baseUrl.replace(/\/+$/, '')}/api/app-auth/oauth/${provider}/start?redirectTo=${encodeURIComponent(redirectTo)}&codeChallenge=${encodeURIComponent(codeChallenge)}`,
  /** Trades the one-time code for a session. A wrong verifier spends the code: start the sign-in again. */
  exchangeCode: (code: string, codeVerifier: string) =>
    request<AppSession>(APP_AUTH_PATHS.oauthExchange, { method: 'POST', body: { code, codeVerifier } }),
});

export type AppAuthApi = ReturnType<typeof createAppAuthApi>;
