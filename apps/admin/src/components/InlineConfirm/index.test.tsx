// @vitest-environment jsdom
import '@/test/dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineConfirm } from '.';

const COMMON = {
  title: 'Revoke this session?',
  description: 'That device will be signed out.',
  confirmLabel: 'Revoke',
} as const;

const renderTrigger = (props: Partial<Parameters<typeof InlineConfirm>[0]> = {}) => {
  const onConfirm = vi.fn();
  render(
    <InlineConfirm
      {...COMMON}
      tone="danger"
      onConfirm={onConfirm}
      trigger={<Button>Revoke session</Button>}
      {...(props as object)}
    />,
  );
  return { onConfirm, trigger: screen.getByRole('button', { name: 'Revoke session' }) };
};

describe('InlineConfirm (trigger mode)', () => {
  it('opens an alertdialog named by the title and described by the consequence', async () => {
    const user = userEvent.setup();
    const { trigger } = renderTrigger();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    const dialog = await screen.findByRole('alertdialog', { name: COMMON.title });
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      COMMON.description,
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Declared modal, so the aria-hidden page behind it isn't reported as hidden-but-focusable (axe).
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('starts on Cancel for danger, so Enter cancels; Escape returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { onConfirm, trigger } = renderTrigger();
    await user.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('starts on Confirm for the default tone, so Enter confirms and closes', async () => {
    const user = userEvent.setup();
    const { onConfirm, trigger } = renderTrigger({ tone: 'default' });
    await user.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke' })));
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps an async confirm open with a spinner until it resolves, then closes', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    renderTrigger({ onConfirm, pendingLabel: 'Revoking…' });
    await user.click(screen.getByRole('button', { name: 'Revoke session' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    const busy = screen.getByRole<HTMLButtonElement>('button', { name: 'Revoking…' });
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog').isConnected).toBe(true);
    await act(async () => resolve());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('stays open and shows the error when an async confirm fails', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => Promise.reject(new Error('The session is already gone.')));
    renderTrigger({ onConfirm });
    await user.click(screen.getByRole('button', { name: 'Revoke session' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toBeDefined();
    expect(screen.getByRole('alertdialog').isConnected).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Revoke' }).disabled).toBe(false);
  });

  it('lets the caller keep focus elsewhere when it closes (onCloseAutoFocus)', async () => {
    const user = userEvent.setup();
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault();
      screen.getByRole('button', { name: 'Copy' }).focus();
    });
    render(
      <>
        <InlineConfirm
          {...COMMON}
          tone="default"
          onConfirm={() => {}}
          onCloseAutoFocus={onCloseAutoFocus}
          trigger={<Button>Revoke session</Button>}
        />
        <Button>Copy</Button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Revoke session' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy' }));
  });
});

/** A row menu whose Delete item hands off to an anchored InlineConfirm, as tables do. */
const RowMenu = ({ onConfirm }: { onConfirm: () => void }) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <DropdownMenu>
      <InlineConfirm
        {...COMMON}
        title="Delete Editor?"
        confirmLabel="Delete"
        tone="danger"
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={onConfirm}
      >
        <DropdownMenuTrigger asChild>
          <Button>Actions: Editor</Button>
        </DropdownMenuTrigger>
      </InlineConfirm>
      <DropdownMenuContent onCloseAutoFocus={(event) => confirming && event.preventDefault()}>
        <DropdownMenuItem onSelect={() => setConfirming(true)}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

describe('InlineConfirm (anchored mode)', () => {
  it('opens from a menu item, confirms, and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RowMenu onConfirm={onConfirm} />);
    const menuButton = screen.getByRole('button', { name: 'Actions: Editor' });
    await user.click(menuButton);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Editor?' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(menuButton));
  });

  it('cancels with Escape and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RowMenu onConfirm={onConfirm} />);
    const menuButton = screen.getByRole('button', { name: 'Actions: Editor' });
    await user.click(menuButton);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menuButton));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
