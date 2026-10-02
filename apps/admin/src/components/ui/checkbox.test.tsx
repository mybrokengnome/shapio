import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('shows a dash, not a tick, when some but not all are selected', () => {
    const html = renderToStaticMarkup(<Checkbox checked="indeterminate" aria-label="Read" />);
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain('lucide-minus');
    expect(html).not.toContain('lucide-check');
  });
});
