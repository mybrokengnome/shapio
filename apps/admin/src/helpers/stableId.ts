const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * A random v4 UUID for new fields (the stable-ID format of @shapio/schema). `crypto.randomUUID` only exists
 * in secure contexts, and self-hosters may open the admin over plain HTTP on a LAN address, so this falls
 * back to `crypto.getRandomValues`, which works everywhere.
 */
export const newStableId = (): string => {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = hex(bytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
