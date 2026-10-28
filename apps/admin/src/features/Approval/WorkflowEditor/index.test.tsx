// @vitest-environment jsdom
import '@/test/dom';
import type { Role } from '@shapio/client';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { workflowValuesOf } from '../helpers/workflowForm';
import { useApprovalSettingsForm } from '../hooks/useApprovalSettingsForm';
import { WorkflowEditor } from '.';

const role = (id: string, name: string, kind: Role['kind'] = 'admin') => ({ id, name, kind }) as Role;

vi.mock('../hooks/useAdminRoles', () => ({
  useAdminRoles: () => ({ adminRoles: [role('r-legal', 'Legal'), role('r-editor', 'Editor')] }),
}));

type EditorFormProps = { onSave: (values: unknown) => void; unknownRoleIds?: string[] };

const EditorForm = ({ onSave, unknownRoleIds = [] }: EditorFormProps) => {
  const form = useApprovalSettingsForm(
    {
      mode: 'custom',
      workflow: workflowValuesOf({
        stages: [{ id: 'legal', name: 'Legal', roleIds: ['r-legal', 'gone'], required: 1 }],
        selfApproval: false,
      }),
    },
    unknownRoleIds,
  );
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(onSave)(event)}>
      <WorkflowEditor control={form.control} />
      <button type="submit">Save</button>
    </form>
  );
};

const stage = (number: number) => screen.getByRole('group', { name: `Stage ${number}` });

describe('WorkflowEditor (plan approval-workflows)', () => {
  it('lists a deleted role as checked and refuses to save until it is unchecked', async () => {
    const onSave = vi.fn();
    render(<EditorForm onSave={onSave} unknownRoleIds={['gone']} />);
    const deleted = within(stage(1)).getByRole('checkbox', { name: 'Deleted role' });
    expect(deleted.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Uncheck the deleted role before saving.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(deleted);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('adds, moves, and removes stages, never removing the last one, and checks each inline', async () => {
    const onSave = vi.fn();
    render(<EditorForm onSave={onSave} />);
    expect(within(stage(1)).getByRole('button', { name: 'Remove Legal' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    expect(within(stage(2)).getByText('Anyone who may approve change sets')).toBeTruthy();
    fireEvent.change(within(stage(2)).getByLabelText('Sign-offs needed'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await within(stage(2)).findByText('This field is required.')).toBeTruthy();
    expect(within(stage(2)).getByText('Enter a whole number from 1 to 20.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(within(stage(2)).getByLabelText('Name'), { target: { value: 'Publisher' } });
    fireEvent.change(within(stage(2)).getByLabelText('Sign-offs needed'), { target: { value: '2' } });
    fireEvent.click(within(stage(2)).getByRole('button', { name: 'Move Publisher up' }));
    expect(within(stage(1)).getByLabelText<HTMLInputElement>('Name').value).toBe('Publisher');
    fireEvent.click(within(stage(2)).getByRole('checkbox', { name: 'Deleted role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      workflow: {
        stages: [
          { stageId: null, name: 'Publisher', required: '2', roleIds: [] },
          { stageId: 'legal', name: 'Legal', required: '1', roleIds: ['r-legal'] },
        ],
      },
    });

    fireEvent.click(within(stage(1)).getByRole('button', { name: 'Remove Publisher' }));
    expect(screen.queryByRole('group', { name: 'Stage 2' })).toBeNull();
  });
});
