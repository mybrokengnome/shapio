import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { FieldGrid } from '.';

const product = model({
  display: { layout: 'form' },
  fields: [
    field({ apiKey: 'name' }),
    field({ apiKey: 'price', type: 'decimal', width: 'half' }),
    field({ apiKey: 'sku', width: 'third' }),
    field({ apiKey: 'notes', type: 'text', width: 'two-thirds' }),
  ],
});

const render = (mode?: 'compact' | 'widths') =>
  renderToStaticMarkup(
    <FieldGrid
      fields={product.fields}
      mode={mode}
      renderField={(item, className) => <div key={item.id} data-key={item.apiKey} className={className} />}
    />,
  );

const spanOf = (html: string, apiKey: string) =>
  new RegExp(`data-key="${apiKey}" class="([^"]*)"`).exec(html)?.[1];

describe('FieldGrid', () => {
  it('spans each field by its width on a six-column grid in widths mode', () => {
    const html = render('widths');
    expect(html).toContain('@lg:grid-cols-6');
    expect(spanOf(html, 'name')).toBe('@lg:col-span-6');
    expect(spanOf(html, 'price')).toBe('@lg:col-span-3');
    expect(spanOf(html, 'sku')).toBe('@lg:col-span-2');
    expect(spanOf(html, 'notes')).toBe('@lg:col-span-4');
  });

  it('keeps the automatic compact split by default, whatever the widths', () => {
    const html = render();
    expect(html).toContain('@2xl:grid-cols-2');
    expect(spanOf(html, 'name')).toBe('@2xl:col-span-1');
    expect(spanOf(html, 'price')).toBe('@2xl:col-span-1');
    expect(spanOf(html, 'notes')).toBe('@2xl:col-span-2');
  });
});
