import { randomBytes } from 'node:crypto';
import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * argon2id with the OWASP-recommended baseline (19 MiB, 2 passes, 1 lane). The library's `Algorithm` is
 * an ambient const enum, which isolated modules cannot read, so the value is spelled out: 2 = Argon2id.
 */
const ARGON2_OPTIONS: Options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_OPTIONS);

let dummyHash: Promise<string> | undefined;

/** A hash of a random password, computed once, for checking passwords of accounts that do not exist. */
const getDummyHash = (): Promise<string> => {
  dummyHash ??= hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS);
  return dummyHash;
};

/**
 * Verifies `password` against `passwordHash`. With no hash (unknown email, or an account that cannot log
 * in) it still runs a full argon2 verification against a dummy hash and returns false, so response time
 * does not reveal whether an account exists.
 */
export const verifyPassword = async (
  password: string,
  passwordHash: string | undefined,
): Promise<boolean> => {
  if (passwordHash === undefined) {
    await verify(await getDummyHash(), password);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash is a failed login, never a crash or a bypass.
    return false;
  }
};

/** Prepares the dummy hash at startup so the first unknown-email login is not measurably faster. */
export const warmUpPasswordHashing = async (): Promise<void> => {
  await getDummyHash();
};
