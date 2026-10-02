// @vitest-environment jsdom
import '@/test/dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { useDiscardGuard } from './useDiscardGuard';

type HarnessProps = { dirty: boolean; pending?: boolean; onOpenChange: (open: boolean) => void };

const Harness = ({ dirty, pending, onOpenChange }: HarnessProps) => {
  const { requestOpenChange, discardPrompt } = useDiscardGuard({
    dirty,
    onOpenChange,
    ...(pending === undefined ? {} : { pending }),
  });
  return (
    <>
      <Button onClick={() => requestOpenChange(false)}>Close</Button>
      <Button onClick={() => requestOpenChange(true)}>Open</Button>
      {discardPrompt}
    </>
  );
};

describe('useDiscardGuard', () => {
  it('passes opening and clean closing straight through', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness dirty={false} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before closing over unsaved edits, and closes only on Discard and leave', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness dirty onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    const prompt = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(prompt.isConnected).toBe(false));
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Discard and leave' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not intercept while a save is pending', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness dirty pending onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
