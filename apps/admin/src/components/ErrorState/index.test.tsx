// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError } from '@shapio/client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorState } from '.';

describe('ErrorState', () => {
  it("keeps the permission message for Shapio's own 403", () => {
    render(<ErrorState error={new ShapioApiError(403, { error: { code: 'FORBIDDEN', message: 'No.' } })} />);
    expect(screen.getByText("You don't have permission to see this.")).toBeDefined();
    expect(screen.queryByText(/blocked before it reached Shapio/)).toBeNull();
  });

  it('says a 403 from a firewall or proxy was blocked, with Try again', () => {
    render(
      <ErrorState
        error={new ShapioApiError(403, '<html>Request blocked</html>')}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'The request was blocked before it reached Shapio (HTTP 403).',
    );
    expect(screen.queryByText("You don't have permission to see this.")).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});
