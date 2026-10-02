// @vitest-environment jsdom
import '@/test/dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RolesPopover, type RolesValues, type SingleRoleValues } from '.';

const OPTIONS = [
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

/** A row menu whose "Change roles" item opens the checklist anchored to the row's roles, as tables do. */
const Row = ({ onSave, emptyMessage }: { onSave: (values: RolesValues) => void; emptyMessage?: string }) => {
  const [open, setOpen] = useState(false);
  const form = useForm<RolesValues>({ defaultValues: { roleIds: ['editor'] } });
  return (
    <>
      <RolesPopover
        open={open}
        onOpenChange={setOpen}
        title="Roles for Ada"
        selection="multiple"
        control={form.control}
        options={emptyMessage ? [] : OPTIONS}
        {...(emptyMessage ? { emptyMessage } : {})}
        dirty={form.formState.isDirty}
        pending={false}
        error={null}
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            onSave(values);
            setOpen(false);
          })(event)
        }
      >
        <span>Editor</span>
      </RolesPopover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Actions: Ada</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={(event) => open && event.preventDefault()}>
          <DropdownMenuItem onSelect={() => setOpen(true)}>Change roles</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

/** An admin user's one role, as a radio list. */
const SingleRoleRow = ({ onSave }: { onSave: (values: SingleRoleValues) => void }) => {
  const [open, setOpen] = useState(true);
  const form = useForm<SingleRoleValues>({ defaultValues: { roleId: 'editor' } });
  return (
    <RolesPopover
      open={open}
      onOpenChange={setOpen}
      title="Roles for Ada"
      selection="single"
      control={form.control}
      options={OPTIONS}
      dirty={form.formState.isDirty}
      pending={false}
      error={null}
      onSubmit={(event) => void form.handleSubmit(onSave)(event)}
    >
      <span>Editor</span>
    </RolesPopover>
  );
};

const openChecklist = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Actions: Ada' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Change roles' }));
  return screen.findByRole('dialog', { name: 'Roles for Ada' });
};

describe('RolesPopover', () => {
  it('opens from the menu as a named checklist, saves, and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Row onSave={onSave} />);
    await openChecklist(user);
    expect(screen.getByRole('checkbox', { name: 'Editor' }).getAttribute('data-state')).toBe('checked');
    await user.click(screen.getByRole('checkbox', { name: 'Viewer' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith({ roleIds: ['editor', 'viewer'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions: Ada' })),
    );
  });

  it('asks before discarding unsaved ticks', async () => {
    const user = userEvent.setup();
    render(<Row onSave={vi.fn()} />);
    await openChecklist(user);
    await user.click(screen.getByRole('checkbox', { name: 'Viewer' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const prompt = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(prompt).toBeDefined();
    // Still open behind the prompt (hidden from assistive technology while the prompt is up).
    expect(screen.getByRole('dialog', { name: 'Roles for Ada', hidden: true })).toBeDefined();
  });

  it('offers exactly one role as a radio list in single mode', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SingleRoleRow onSave={onSave} />);
    const group = await screen.findByRole('radiogroup', { name: 'Roles for Ada' });
    expect(group).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Editor' }).getAttribute('data-state')).toBe('checked');
    await user.click(screen.getByRole('radio', { name: 'Viewer' }));
    expect(screen.getByRole('radio', { name: 'Editor' }).getAttribute('data-state')).toBe('unchecked');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ roleId: 'viewer' }, expect.anything()));
  });

  it('shows the empty message instead of a checklist when there is nothing to pick', async () => {
    const user = userEvent.setup();
    render(<Row onSave={vi.fn()} emptyMessage="There are no custom app roles yet." />);
    await openChecklist(user);
    expect(screen.getByText('There are no custom app roles yet.')).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
