/** Thrown by adapters when a key has no object, so callers can tell "missing" from "storage is down". */
export class ObjectNotFoundError extends Error {
  constructor(key: string, options?: ErrorOptions) {
    super(`No stored object at ${key}`, options);
    this.name = 'ObjectNotFoundError';
  }
}

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`Not a valid media storage key: ${JSON.stringify(key)}`);
    this.name = 'InvalidStorageKeyError';
  }
}
