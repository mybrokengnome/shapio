import { describe, expect, it } from 'vitest';
import { shapioAttr } from './attributes.js';

const ID = '3f1c2b9a-8d7e-4f60-9a1b-2c3d4e5f6a7b';

describe('shapioAttr', () => {
  it('takes an entry ID and a path', () => {
    expect(shapioAttr(ID, 'title')).toEqual({ 'data-shapio-entry': ID, 'data-shapio-path': 'title' });
  });

  it("uses a delivery item's id and locale, and drops a leading slash", () => {
    expect(shapioAttr({ id: ID, locale: 'fr' }, '/sections/2/heading')).toEqual({
      'data-shapio-entry': ID,
      'data-shapio-path': 'sections/2/heading',
      'data-shapio-locale': 'fr',
    });
  });

  it('lets an explicit locale win over the entry locale', () => {
    expect(shapioAttr({ id: ID, locale: 'fr' }, 'body', 'en')['data-shapio-locale']).toBe('en');
  });

  it('leaves the locale out when it is unknown', () => {
    expect(shapioAttr({ id: ID, locale: null }, 'body')).not.toHaveProperty('data-shapio-locale');
  });
});
