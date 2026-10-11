// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewGroup } from '.';

const renderNewGroup = () => {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  const onParentKeyDown = vi.fn((event: { nativeEvent: Event }) => event.nativeEvent.defaultPrevented);
  render(
    // The field panel's own Escape handler, which must see Escape as handled.
    <div onKeyDown={onParentKeyDown}>
      <NewGroup id="new-group" disabled={false} onCreate={onCreate} onCancel={onCancel} />
    </div>,
  );
  return { onCreate, onCancel, onParentKeyDown, input: screen.getByLabelText('Group name') };
};

describe('NewGroup', () => {
  it('creates the trimmed name on Enter', async () => {
    const { onCreate, input } = renderNewGroup();
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, '  Pricing {Enter}');
    expect(onCreate).toHaveBeenCalledWith('Pricing');
  });

  it('cannot create an empty name', async () => {
    const { onCreate, input } = renderNewGroup();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(true);
    await userEvent.type(input, '   {Enter}');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('cancels on Escape and marks it handled for the field panel', async () => {
    const { onCancel, onParentKeyDown } = renderNewGroup();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    expect(onParentKeyDown).toHaveReturnedWith(true);
  });
});
