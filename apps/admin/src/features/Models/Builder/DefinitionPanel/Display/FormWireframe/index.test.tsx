// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../../../../../packages/schema/src/testing/fixtures';
import { FormWireframe } from '.';

const product = () =>
  model({
    display: {
      layout: 'form',
      groups: [{ id: 'pricing', label: 'Pricing', fieldIds: ['price-id', 'sku-id'] }],
    },
    fields: [
      field({ apiKey: 'name', label: 'Name' }),
      field({ id: 'price-id', apiKey: 'price', label: 'Price', type: 'decimal', width: 'half' }),
      field({ id: 'sku-id', apiKey: 'sku', label: 'SKU', width: 'half' }),
      field({ apiKey: 'notes', label: 'Notes', deprecated: true }),
    ],
  });

describe('FormWireframe', () => {
  it('draws each section and its live fields at their widths', () => {
    render(<FormWireframe model={product()} />);
    expect(screen.getByText('Form preview: 3 fields').className).toBe('sr-only');
    screen.getByText('Pricing');
    expect(screen.getByText('Name').classList).toContain('col-span-6');
    expect(screen.getByText('Price').classList).toContain('col-span-3');
    expect(screen.getByText('SKU').classList).toContain('col-span-3');
    expect(screen.queryByText('Notes')).toBeNull();
  });

  it('draws nothing for a model without fields', () => {
    const { container } = render(<FormWireframe model={model({ display: { layout: 'form' } })} />);
    expect(container.innerHTML).toBe('');
  });
});
