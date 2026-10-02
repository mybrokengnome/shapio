import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './safeExternalUrl';

describe('safeExternalUrl', () => {
  it('keeps http and https URLs', () => {
    expect(safeExternalUrl('https://ci.example.com/build/1')).toBe('https://ci.example.com/build/1');
    expect(safeExternalUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/');
  });

  it.each([null, undefined, '', 'javascript:alert(1)', 'data:text/html,hi', '/relative', 'not a url'])(
    'drops %j',
    (value) => {
      expect(safeExternalUrl(value)).toBeUndefined();
    },
  );
});
