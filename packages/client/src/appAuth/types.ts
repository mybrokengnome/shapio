/**
 * App-user authentication (package I), mirroring apps/api/src/routes/app-auth/schemas.ts. For the sites and
 * apps built on Shapio: their end users sign up, sign in and manage their accounts here.
 */

export type AppUser = {
  id: string;
  email: string;
  name: string;
  confirmed: boolean;
  hasPassword: boolean;
  providers: string[];
  createdAt: string;
  lastLoginAt: string | null;
};

/** Send `accessToken` as `Authorization: Bearer …`; trade `refreshToken` for a new pair before it expires. */
export type AppSession = {
  user: AppUser;
  accessToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  /** Single use: each refresh returns the next one. Presenting a used one signs the session out. */
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export type AppRegisterInput = { email: string; password: string; name?: string };

/**
 * Signed in at once (HTTP 201), or, when the instance requires a confirmed email, `{ confirmationRequired:
 * true }` (HTTP 202): "check your email". That answer is the same whether or not the address already had an
 * account, so it never reveals who is registered.
 */
export type AppRegisterResult =
  { confirmationRequired: false; user: AppUser; session: AppSession } | { confirmationRequired: true };

export type AppLoginInput = { email: string; password: string };

export type AppChangePasswordInput = { currentPassword?: string; newPassword: string };

export type AppOAuthProvider = 'google' | 'github';
