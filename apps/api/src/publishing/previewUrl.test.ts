import { describe, expect, it } from 'vitest';
import { renderPreviewUrl } from './previewUrl.js';

describe('preview URL templates', () => {
  it('fills and encodes the variables', () => {
    expect(
      renderPreviewUrl('https://preview.example.com/{path}?token={token}&locale={locale}', {
        token: 'shpv_a.b',
        modelKey: 'pages',
        entryId: '0b6c',
        locale: 'pt-BR',
      }),
    ).toBe('https://preview.example.com/pages/0b6c?token=shpv_a.b&locale=pt-BR');
    expect(
      renderPreviewUrl('https://site.test/{modelKey}/{entryId}?t={token}', {
        token: 'a&b',
        modelKey: 'posts',
        entryId: 'x/y',
        locale: 'en',
      }),
    ).toBe('https://site.test/posts/x%2Fy?t=a%26b');
  });

  it('refuses templates that do not make an http(s) URL', () => {
    expect(() =>
      renderPreviewUrl('javascript:alert({token})', {
        token: 't',
        modelKey: 'm',
        entryId: 'e',
        locale: 'en',
      }),
    ).toThrow();
    expect(() =>
      renderPreviewUrl('{path}', { token: 't', modelKey: 'm', entryId: 'e', locale: 'en' }),
    ).toThrow();
  });
});
