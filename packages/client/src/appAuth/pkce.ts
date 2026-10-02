/**
 * PKCE (RFC 7636) for the app side of Shapio's OAuth sign-in: the app keeps the verifier (e.g. in
 * sessionStorage) and sends the S256 challenge with the start link; the one-time code it gets back is only
 * exchanged together with that verifier. Uses Web Crypto, so it works in browsers and Node alike.
 */
export type AppPkcePair = { codeVerifier: string; codeChallenge: string };

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The S256 challenge of a verifier: base64url(SHA-256(verifier)). */
export const codeChallengeOf = async (codeVerifier: string): Promise<string> =>
  toBase64Url(
    new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))),
  );

/** A fresh verifier (32 random bytes, 43 characters) and its S256 challenge. */
export const createPkcePair = async (): Promise<AppPkcePair> => {
  const codeVerifier = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  return { codeVerifier, codeChallenge: await codeChallengeOf(codeVerifier) };
};
