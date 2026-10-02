import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import { PageHeader } from '.';

beforeAll(async () => {
  await initI18n();
});

describe('PageHeader', () => {
  it('renders the title as the page heading with its badge, meta and actions', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Articles"
        badge={<span>badge</span>}
        meta="112 entries"
        actions={<button type="button">Create entry</button>}
      />,
    );
    expect(html).toMatch(/<h1 class="[^"]*text-title[^"]*">Articles<\/h1><span>badge<\/span>/);
    expect(html).toContain('112 entries');
    expect(html).toContain('Create entry');
  });

  it('labels the breadcrumb trail', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Hello" breadcrumb={[{ label: 'Content' }, { label: 'Articles' }]} />,
    );
    expect(html).toContain('<nav aria-label="Breadcrumb">');
    expect(html).toContain('Content');
    expect(html).toContain('Articles');
  });
});
