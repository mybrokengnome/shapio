import { describe, expect, it } from 'vitest';
import { loadPlaygroundAssets, renderPlaygroundPage } from './playground.js';

const urls = { assets: '/api/graphql/playground', endpoint: '/api/graphql', csrf: '/api/admin/auth/csrf' };

describe('renderPlaygroundPage', () => {
  it('opens on a query and a theme, escaped into data attributes', () => {
    const page = renderPlaygroundPage(urls, {
      query: 'query {\n  pages(search: "a<b>&\'") { totalCount }\n}',
      theme: 'dark',
    });
    expect(page).toContain(
      'data-query="query {\n  pages(search: &quot;a&lt;b&gt;&amp;&#39;&quot;) { totalCount }\n}"',
    );
    expect(page).toContain('data-theme="dark"');
    expect(page).not.toContain('<b>');
  });

  it('leaves both out when not given (GraphiQL keeps its own tabs and theme)', () => {
    const page = renderPlaygroundPage(urls);
    expect(page).not.toContain('data-query');
    expect(page).not.toContain('data-theme');
    expect(renderPlaygroundPage(urls, { query: '' })).not.toContain('data-query');
  });

  it('hands the query and theme to GraphiQL in the bootstrap script', () => {
    const script = loadPlaygroundAssets().get('playground.js')?.body.toString() ?? '';
    expect(script).toContain('props.query = root.dataset.query');
    expect(script).toContain('props.forcedTheme = root.dataset.theme');
  });
});
