// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SaveState } from '.';

const autosavedNow = { status: 'saved', kind: 'autosave', at: '2026-10-10T21:01:00.000Z' } as const;

describe('SaveState', () => {
  it('shows only the short form when compact, with the full sentence as the title', () => {
    render(<SaveState state={autosavedNow} dirty={false} autosaved compact />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Draft autosaved');
    expect(status.getAttribute('title')).toMatch(/^Draft autosaved .*2026/);
  });

  it('keeps the time for wide screens only when not compact', () => {
    render(<SaveState state={autosavedNow} dirty={false} autosaved />);
    const status = screen.getByRole('status');
    const short = screen.getByText('Draft autosaved');
    expect(short.className).toContain('xl:hidden');
    const full = [...status.querySelectorAll('span')].find((span) => span !== short);
    expect(full?.className).toContain('max-xl:hidden');
    expect(full?.textContent).toMatch(/2026/);
  });

  it('shows a sentence without a time once, whatever the width', () => {
    render(<SaveState state={{ status: 'idle', kind: undefined, at: undefined }} dirty autosaved={false} />);
    expect(screen.getByRole('status').querySelectorAll('span')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
  });
});
