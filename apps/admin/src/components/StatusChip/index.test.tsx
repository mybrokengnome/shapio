import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusChip } from '.';

describe('StatusChip', () => {
  it('shows the label with a dot whose colour follows the tone', () => {
    const html = renderToStaticMarkup(<StatusChip tone="success" label="Published" />);
    expect(html).toContain('Published');
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('bg-success-muted');
    expect(html).toMatch(/aria-hidden="true" class="[^"]*bg-success/);
  });

  it('spins for live progress and shows a plain dot once the work is over', () => {
    expect(renderToStaticMarkup(<StatusChip tone="progress" label="Running" />)).toContain('animate-spin');
    expect(renderToStaticMarkup(<StatusChip tone="progress" label="Ran" live={false} />)).not.toContain(
      'animate-spin',
    );
  });
});
