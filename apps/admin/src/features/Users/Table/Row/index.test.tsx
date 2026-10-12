// @vitest-environment jsdom
import '@/test/dom';
import type { AdminUser } from '@shapio/client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Row } from '.';

const user = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u1',
  email: 'eve@example.com',
  name: 'Eve',
  status: 'active',
  assignments: [],
  roleIds: [],
  lastLoginAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  apiTokens: [],
  ...overrides,
});

const TOKENS = [
  { id: 't1', name: 'Production build', siteId: 's1' },
  { id: 't2', name: 'CLI', siteId: null },
];

const renderRow = (subject: AdminUser) => {
  const onToggleStatus = vi.fn(() => Promise.resolve());
  const onRemove = vi.fn(() => Promise.resolve());
  render(
    <table>
      <tbody>
        <Row
          user={subject}
          roleNames={new Map()}
          siteNames={new Map()}
          isSelf={false}
          onToggleStatus={onToggleStatus}
          onRemove={onRemove}
        />
      </tbody>
    </table>,
  );
  return { onToggleStatus, onRemove };
};

const chooseFromMenu = async (item: string) => {
  await userEvent.click(screen.getByRole('button', { name: 'Actions: Eve' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
};

describe('Users row', () => {
  it('disables at once when the person has no API tokens', async () => {
    const { onToggleStatus } = renderRow(user());
    await chooseFromMenu('Disable');
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('confirms disabling when the person has API tokens, naming the tokens that stop working', async () => {
    const { onToggleStatus } = renderRow(user({ apiTokens: TOKENS }));
    await chooseFromMenu('Disable');
    const dialog = await screen.findByRole('alertdialog', { name: 'Disable Eve?' });
    expect(dialog.textContent).toContain(
      'the 2 API tokens they created will stop working until they are enabled again: “Production build” and “CLI”.',
    );
    expect(onToggleStatus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
  });

  it('enables a disabled person at once, tokens or not', async () => {
    const { onToggleStatus } = renderRow(user({ status: 'disabled', apiTokens: TOKENS }));
    await chooseFromMenu('Enable');
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
  });

  it('says which API tokens are revoked when the person is removed', async () => {
    const { onRemove } = renderRow(user({ apiTokens: [TOKENS[0]!] }));
    await chooseFromMenu('Remove');
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Eve?' });
    expect(dialog.textContent).toContain('The API token they created will be revoked: “Production build”.');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps the plain removal copy when the person has no API tokens', async () => {
    renderRow(user());
    await chooseFromMenu('Remove');
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Eve?' });
    expect(dialog.textContent).not.toContain('API token');
  });
});
