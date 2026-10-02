// @vitest-environment jsdom
import '@/test/dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormSheet } from '.';

type HarnessProps = {
  dirty?: boolean;
  onSubmit?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
};

const Harness = ({ dirty = false, onSubmit = () => {}, onCloseAutoFocus }: HarnessProps) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New token</Button>
      <Button>Elsewhere</Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Create API token"
        size="md"
        dirty={dirty}
        pending={false}
        submitLabel="Create"
        pendingLabel="Creating…"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <Input aria-label="Name" />
      </FormSheet>
    </>
  );
};

const sheet = () => screen.queryByRole('dialog', { name: 'Create API token' });
const opener = () => screen.getByRole('button', { name: 'New token' });

const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(opener());
  await screen.findByRole('dialog', { name: 'Create API token' });
};

describe('FormSheet', () => {
  it('is a dialog named by its title, sized by `size`, that submits its form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await openSheet(user);
    expect(sheet()?.getAttribute('data-size')).toBe('md');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('closes a clean form on Escape without asking and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openSheet(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet()).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });

  it('asks before discarding unsaved edits: Keep editing stays, Discard and leave closes', async () => {
    const user = userEvent.setup();
    render(<Harness dirty />);
    await openSheet(user);
    await user.keyboard('{Escape}');
    const prompt = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(prompt.isConnected).toBe(false));
    expect(sheet()).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(screen.getByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => expect(sheet()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });

  it('lets the caller keep focus elsewhere when it closes (onCloseAutoFocus)', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          screen.getByRole('button', { name: 'Elsewhere' }).focus();
        }}
      />,
    );
    await openSheet(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet()).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });
});
