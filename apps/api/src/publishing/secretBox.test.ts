import { describe, expect, it } from 'vitest';
import { createSecretBox } from './secretBox.js';

describe('secret box', () => {
  const box = createSecretBox('a-signing-secret-of-at-least-32-characters');

  it('round-trips values and JSON documents with a fresh IV each time', () => {
    const sealed = box.encrypt('cf-token');
    expect(sealed).not.toContain('cf-token');
    expect(box.encrypt('cf-token')).not.toBe(sealed);
    expect(box.decrypt(sealed)).toBe('cf-token');
    expect(box.decryptJson(box.encryptJson({ apiToken: 'x', deployHookUrl: 'y' }))).toEqual({
      apiToken: 'x',
      deployHookUrl: 'y',
    });
  });

  it('refuses tampered values and values sealed under another signing secret', () => {
    const sealed = box.encrypt('secret');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.decrypt(parts.join(':'))).toThrow(/cannot be decrypted/);
    expect(() => createSecretBox('another-signing-secret-of-32-characters!').decrypt(sealed)).toThrow(
      /cannot be decrypted/,
    );
  });

  it('makes stable MACs per secret', () => {
    expect(box.mac('abc')).toBe(box.mac('abc'));
    expect(box.mac('abc')).not.toBe(createSecretBox('another-signing-secret-of-32-characters!').mac('abc'));
  });
});
