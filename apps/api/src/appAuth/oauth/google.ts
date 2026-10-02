import { accessTokenOf, asRecord, authorizationUrl, getJson, postForm } from './http.js';
import { OAuthProviderError, type OAuthEndpoints, type OAuthProviderAdapter } from './types.js';

export const GOOGLE_ENDPOINTS: OAuthEndpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  // OpenID Connect userinfo: { sub, email, email_verified, name, given_name, family_name, picture, … }.
  userInfo: 'https://openidconnect.googleapis.com/v1/userinfo',
};

/** Google OAuth 2.0 / OpenID Connect with PKCE (S256). Scopes: `openid email profile`. */
export const createGoogleAdapter = (endpoints: OAuthEndpoints = GOOGLE_ENDPOINTS): OAuthProviderAdapter => ({
  id: 'google',
  authorizationUrl: ({ client, redirectUri, state, codeChallenge }) =>
    authorizationUrl(endpoints.authorize, {
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }),
  fetchProfile: async ({ client, redirectUri, code, codeVerifier }) => {
    const accessToken = accessTokenOf(
      await postForm(endpoints.token, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code_verifier: codeVerifier,
      }),
    );
    const info = asRecord(await getJson(endpoints.userInfo, accessToken));
    if (typeof info.sub !== 'string' || info.sub.length === 0) {
      throw new OAuthProviderError('PROVIDER_ERROR', 'Google returned a profile without a subject');
    }
    const email = typeof info.email === 'string' ? info.email : null;
    return {
      providerUserId: info.sub,
      email,
      // Older Google responses carried the flag as the string "true".
      emailVerified: email !== null && (info.email_verified === true || info.email_verified === 'true'),
      name: typeof info.name === 'string' ? info.name : '',
    };
  },
});
