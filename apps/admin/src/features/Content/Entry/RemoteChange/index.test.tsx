// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RemoteChange } from '.';

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

describe('RemoteChange', () => {
  it('names who changed the draft a moment ago and reloads on request', async () => {
    const onReload = vi.fn();
    render(
      <TooltipProvider>
        <RemoteChange
          change={{ savedAt: secondsAgo(5), savedBy: { name: 'Ana', you: false } }}
          busy={false}
          onReload={onReload}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('Changed by Ana a moment ago. Reload to see it.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('says only "Changed elsewhere" on a narrow bar, with the name in the title', () => {
    render(
      <TooltipProvider>
        <RemoteChange
          change={{ savedAt: secondsAgo(5), savedBy: { name: 'Ana', you: false } }}
          busy={false}
          onReload={vi.fn()}
          compact
        />
      </TooltipProvider>,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Changed elsewhere');
    expect(status.getAttribute('title')).toMatch(/^Changed by Ana a moment ago\. Reload to see it\./);
  });

  it('says "you elsewhere" for the same person, and the time once it is older than a minute', () => {
    render(
      <TooltipProvider>
        <RemoteChange
          change={{ savedAt: secondsAgo(300), savedBy: { name: 'Me', you: true } }}
          busy={false}
          onReload={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Changed by you elsewhere 5 min. ago. Reload to see it.',
    );
  });

  it('leaves the name out when it is not known, and keeps a short text on a narrow bar', () => {
    const { rerender } = render(
      <TooltipProvider>
        <RemoteChange change={{ savedAt: secondsAgo(1), savedBy: null }} busy={false} onReload={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('Changed a moment ago. Reload to see it.');
    rerender(
      <TooltipProvider>
        <RemoteChange change={{ savedAt: secondsAgo(1), savedBy: null }} busy onReload={vi.fn()} compact />
      </TooltipProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('Changed elsewhere');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reload' }).disabled).toBe(true);
  });
});
