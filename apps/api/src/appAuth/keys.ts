import { hkdfSync } from 'node:crypto';

/**
 * Keys derived from the instance signing secret (SESSION_SECRET or the generated one), one per purpose, so
 * no key is ever used for two things. Rotating the secret signs every app user out, which is the point.
 */
export type AppAuthKeys = {
  /** HMAC-SHA256 key of app-user access tokens (JWT HS256). */
  accessToken: Buffer;
  /** HMAC-SHA256 key of the OAuth state cookie. */
  oauthState: Buffer;
  /** Derives a refresh token's replacement from it, so a retry within the grace gets the same one. */
  refreshRotation: Buffer;
};

const derive = (secret: string, purpose: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, 'shapio-app-auth', purpose, 32));

export const deriveAppAuthKeys = (signingSecret: string): AppAuthKeys => ({
  accessToken: derive(signingSecret, 'access-token-v1'),
  oauthState: derive(signingSecret, 'oauth-state-v1'),
  refreshRotation: derive(signingSecret, 'refresh-rotation-v1'),
});
