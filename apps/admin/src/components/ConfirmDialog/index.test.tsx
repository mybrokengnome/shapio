// @vitest-environment jsdom
import '@/test/dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '.';

const BASE = {
  title: 'Delete Canadian French?',
  description: 'Its content is purged in the background.',
  confirmLabel: 'Delete',
  destructive: true,
} as const;

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

describe('ConfirmDialog', () => {
  it('starts on Cancel and closes on Confirm in the default (sync) mode', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...BASE} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    expect(screen.getByRole('alertdialog', { name: BASE.title })).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(button('Cancel')));
    await user.click(button('Delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps Confirm disabled until the acknowledgement is ticked, and unticks it on reopen', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const props = {
      ...BASE,
      onOpenChange: () => {},
      onConfirm,
      acknowledgement: 'I understand 12 entries lose it.',
    };
    const { rerender } = render(<ConfirmDialog {...props} open />);
    expect(button('Delete').disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: props.acknowledgement }));
    expect(button('Delete').disabled).toBe(false);
    await user.click(button('Delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(<ConfirmDialog {...props} open={false} />);
    rerender(<ConfirmDialog {...props} open />);
    expect(screen.getByRole('checkbox', { name: props.acknowledgement }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(button('Delete').disabled).toBe(true);
  });

  it('in async mode stays open on Confirm, and while pending shows progress and ignores Escape', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const props = { ...BASE, open: true, onOpenChange, onConfirm, pendingLabel: 'Deleting…' };
    const { rerender } = render(<ConfirmDialog {...props} pending={false} />);
    await user.click(button('Delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    rerender(<ConfirmDialog {...props} pending />);
    const busy = button('Deleting…');
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(button('Cancel').disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows the failed attempt’s error in async mode', () => {
    render(
      <ConfirmDialog
        {...BASE}
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        pending={false}
        error={new Error('boom')}
      />,
    );
    expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toBeDefined();
  });
});
