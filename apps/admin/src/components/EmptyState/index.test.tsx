// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '.';

describe('EmptyState', () => {
  it('compact: one row with a small tile, the title and the description inline', () => {
    const { container } = render(
      <EmptyState compact icon={Inbox} title="Nothing scheduled" description="Schedule from an entry." />,
    );
    const row = container.firstElementChild;
    expect(row?.className).toContain('py-3');
    expect(row?.className).not.toContain('flex-col');
    expect(container.querySelector('.size-8')).not.toBeNull();
    expect(screen.getByText('Nothing scheduled').closest('p')?.textContent).toBe(
      'Nothing scheduled Schedule from an entry.',
    );
  });

  it('default: the centred block', () => {
    const { container } = render(<EmptyState size="panel" title="No media yet" />);
    expect(container.firstElementChild?.className).toContain('flex-col');
  });
});
