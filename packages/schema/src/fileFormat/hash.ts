import type { SchemaDefinition } from '../types/definitions.js';
import { serializeDefinition } from './canonical.js';

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** `sha256:<hex>` of a UTF-8 string, via Web Crypto (Node and browsers alike). */
export const sha256 = async (text: string): Promise<string> =>
  `sha256:${toHex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))}`;

/** Hash of a normalized definition's canonical serialization; recorded per model in the lock file. */
export const hashDefinition = (definition: SchemaDefinition): Promise<string> =>
  sha256(serializeDefinition(definition));
