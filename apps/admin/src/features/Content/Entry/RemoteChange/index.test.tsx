// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RemoteChange } from '.';

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

describe('RemoteChange', () => {
  it('names who changed the draft a moment ago and reloads on request', async () => {
    const onReload = vi.fn();
    render(
      <RemoteChange
        change={{ savedAt: secondsAgo(5), savedBy: { name: 'Ana', you: false } }}
        busy={false}
        onReload={onReload}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Changed by Ana a moment ago. Reload to see it.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('keeps the name in the short text on a narrow bar', () => {
    render(
      <RemoteChange
        change={{ savedAt: secondsAgo(5), savedBy: { name: 'Ana', you: false } }}
        busy={false}
        onReload={vi.fn()}
        compact
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Changed by Ana');
  });

  it('says "you elsewhere" for the same person, and the time once it is older than a minute', () => {
    render(
      <RemoteChange
        change={{ savedAt: secondsAgo(300), savedBy: { name: 'Me', you: true } }}
        busy={false}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Changed by you elsewhere 5 min. ago. Reload to see it.',
    );
  });

  it('leaves the name out when it is not known, and keeps a short text on a narrow bar', () => {
    const { rerender } = render(
      <RemoteChange change={{ savedAt: secondsAgo(1), savedBy: null }} busy={false} onReload={vi.fn()} />,
    );
    expect(screen.getByRole('status').textContent).toBe('Changed a moment ago. Reload to see it.');
    rerender(
      <RemoteChange change={{ savedAt: secondsAgo(1), savedBy: null }} busy onReload={vi.fn()} compact />,
    );
    expect(screen.getByRole('status').textContent).toBe('Changed elsewhere');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reload' }).disabled).toBe(true);
  });
});
