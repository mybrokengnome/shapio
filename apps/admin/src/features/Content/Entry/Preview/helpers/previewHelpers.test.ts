import { describe, expect, it } from 'vitest';
import { component, field, model } from '../../../../../../../../packages/schema/src/testing/fixtures';
import { resolvePreviewFocus } from './focusTarget';
import { canFramePreview, framedPreviewUrl } from './previewFrame';
import { acceptSiteMessage } from './previewMessages';

const ENTRY = '3f1c2b9a-8d7e-4f60-9a1b-2c3d4e5f6a7b';
const OTHER = '9a1b2c3d-8d7e-4f60-9a1b-2c3d4e5f6a7b';
const SITE = 'https://site.example.test';
const focus = (path: string, extra: Record<string, unknown> = {}) => ({
  type: 'shapio:focus',
  v: 1,
  entryId: ENTRY,
  path,
  ...extra,
});

describe('acceptSiteMessage', () => {
  const frame = {} as Window;

  it('hears the framed window on the preview origin', () => {
    expect(acceptSiteMessage({ source: frame, origin: SITE, data: focus('title') }, frame, SITE)).toEqual({
      type: 'shapio:focus',
      v: 1,
      entryId: ENTRY,
      path: '/title',
    });
  });

  it.each([
    ['another window', { source: {} as Window, origin: SITE }],
    ['another origin', { source: frame, origin: 'https://evil.example' }],
    ["the admin's own origin", { source: frame, origin: 'https://cms.example.com' }],
    ['no source', { source: null, origin: SITE }],
  ])('ignores %s', (_case, event) => {
    expect(acceptSiteMessage({ ...event, data: focus('title') }, frame, SITE)).toBeUndefined();
  });

  it('ignores everything while there is no frame or origin', () => {
    expect(
      acceptSiteMessage({ source: frame, origin: SITE, data: focus('title') }, null, SITE),
    ).toBeUndefined();
    expect(
      acceptSiteMessage({ source: frame, origin: SITE, data: focus('title') }, frame, undefined),
    ).toBeUndefined();
  });

  it('ignores malformed data from the right sender', () => {
    expect(
      acceptSiteMessage({ source: frame, origin: SITE, data: focus('../x') }, frame, SITE),
    ).toBeUndefined();
  });
});

describe('resolvePreviewFocus', () => {
  const feature = component({
    apiKey: 'feature',
    label: 'Feature',
    fields: [field({ apiKey: 'heading', label: 'Heading' })],
  });
  const article = model({
    localized: true,
    fields: [
      field({ apiKey: 'title', label: 'Title' }),
      field({ apiKey: 'body', label: 'Body', type: 'richtext' }),
      field({
        apiKey: 'sections',
        label: 'Sections',
        type: 'dynamiczone',
        settings: { components: [feature.id] },
      }),
    ],
  });
  const open = {
    entryId: ENTRY,
    locale: 'en',
    model: article,
    components: new Map([[feature.id, feature]]),
    values: { sections: [{ __component: 'feature', heading: 'Maps' }] },
  };
  const resolve = (path: string, extra: Record<string, unknown> = {}) =>
    resolvePreviewFocus({ type: 'shapio:focus', v: 1, entryId: ENTRY, path, ...extra }, open);

  it('focuses the title, a canvas field and a component inside a zone by path', () => {
    expect(resolve('/title')).toEqual({ kind: 'field', path: '/title' });
    expect(resolve('/body')).toEqual({ kind: 'field', path: '/body' });
    expect(resolve('/sections/0/heading', { locale: 'en' })).toEqual({
      kind: 'field',
      path: '/sections/0/heading',
    });
  });

  it('reports another entry, another locale and an unknown path', () => {
    expect(resolve('/title', { entryId: OTHER })).toEqual({ kind: 'otherEntry' });
    expect(resolve('/title', { locale: 'fr' })).toEqual({ kind: 'otherLocale', locale: 'fr' });
    expect(resolve('/missing')).toEqual({ kind: 'unknownField' });
  });

  it('ignores the locale of a model that is not localized', () => {
    expect(
      resolvePreviewFocus(focus('/title', { locale: 'fr' }) as never, { ...open, locale: null }),
    ).toEqual({
      kind: 'field',
      path: '/title',
    });
  });
});

describe('framing', () => {
  it('adds the visual-editing flag and keeps the token fragment', () => {
    expect(framedPreviewUrl(`${SITE}/preview/?id=1#token=shpv_a.b`)).toBe(
      `${SITE}/preview/?id=1&shapio-visual=1#token=shpv_a.b`,
    );
  });

  it("never frames the admin's own origin or a non-http URL", () => {
    expect(canFramePreview(`${SITE}/p`, 'https://cms.example.com')).toBe(true);
    expect(canFramePreview('https://cms.example.com/p', 'https://cms.example.com')).toBe(false);
    expect(canFramePreview('javascript:alert(1)', 'https://cms.example.com')).toBe(false);
  });
});
