import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { AppError } from '../helpers/appError.js';

/**
 * Encryption at rest for secrets Shapio must be able to read back (webhook signing secrets, provider API
 * tokens, deploy hook URLs): AES-256-GCM under a key derived (HKDF-SHA256) from the instance signing secret.
 * Hashing is not an option for these: Shapio has to sign with them or send them. If SESSION_SECRET changes,
 * stored secrets can no longer be decrypted and must be entered again; the error says so.
 */
const FORMAT = 'v1';
const IV_BYTES = 12;
const KEY_INFO = 'shapio:secret-box:v1';
const MAC_INFO = 'shapio:mac:v1';
const MAC_BYTES = 16;

export type SecretBox = {
  encrypt: (plaintext: string) => string;
  decrypt: (sealed: string) => string;
  encryptJson: (value: Record<string, string>) => string;
  decryptJson: (sealed: string) => Record<string, string>;
  /** A short HMAC tag (preview tokens are signed so forged ones are rejected before any lookup). */
  mac: (value: string) => string;
};

export const secretUnreadable = () =>
  new AppError(
    500,
    'SECRET_UNREADABLE',
    'A stored secret cannot be decrypted (the signing secret changed?). Enter the secret again.',
  );

export const createSecretBox = (signingSecret: string): SecretBox => {
  const key = Buffer.from(hkdfSync('sha256', signingSecret, 'shapio', KEY_INFO, 32));
  const macKey = Buffer.from(hkdfSync('sha256', signingSecret, 'shapio', MAC_INFO, 32));
  const encrypt = (plaintext: string) => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [FORMAT, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join(':');
  };
  const decrypt = (sealed: string) => {
    const [format, iv, tag, ciphertext] = sealed.split(':');
    if (format !== FORMAT || !iv || !tag || ciphertext === undefined) {
      throw secretUnreadable();
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new AppError(500, 'SECRET_UNREADABLE', secretUnreadable().message, undefined, { cause: error });
    }
  };
  return {
    mac: (value) =>
      createHmac('sha256', macKey)
        .update(value, 'utf8')
        .digest()
        .subarray(0, MAC_BYTES)
        .toString('base64url'),
    encrypt,
    decrypt,
    encryptJson: (value) => encrypt(JSON.stringify(value)),
    decryptJson: (sealed) => {
      const parsed: unknown = JSON.parse(decrypt(sealed));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw secretUnreadable();
      }
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    },
  };
};
