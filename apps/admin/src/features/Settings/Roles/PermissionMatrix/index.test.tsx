// @vitest-environment jsdom
import '@/test/dom';
import type { ContentAction } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { SiteModel } from '@/api/schema';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MATRIX_RULES_BY_KIND } from '../constants';
import { toMatrix, toPermissions, type MatrixPermission } from './helpers/permissionMatrix';
import { PermissionMatrix } from '.';

const RULES = MATRIX_RULES_BY_KIND.admin;

const model = (id: string, label: string, apiKey: string): ModelDefinition =>
  ({
    id,
    kind: 'collection',
    apiKey,
    label,
    fields: [
      { id: `${id}-title`, apiKey: 'title', label: 'Title', type: 'string', public: true },
      { id: `${id}-notes`, apiKey: 'notes', label: 'Notes', type: 'text', public: false },
    ],
  }) as unknown as ModelDefinition;

const MODELS: SiteModel[] = [
  { definition: model('m-article', 'Article', 'article'), site: null },
  {
    definition: model('m-note', 'Note', 'note'),
    site: { id: 's-blog', key: 'blog', name: 'Blog', isPrimary: false },
  },
];

const Harness = ({
  initial,
  onPermissions,
}: {
  initial: MatrixPermission<ContentAction>[];
  onPermissions: (permissions: MatrixPermission<ContentAction>[]) => void;
}) => {
  const [matrix, setMatrix] = useState(() => toMatrix(initial));
  return (
    <TooltipProvider>
      <PermissionMatrix
        matrix={matrix}
        models={MODELS}
        showSites
        rules={RULES}
        audience="admin"
        onChange={(next) => {
          setMatrix(next);
          onPermissions(toPermissions(next, RULES));
        }}
      />
    </TooltipProvider>
  );
};

const renderMatrix = (initial: MatrixPermission<ContentAction>[]) => {
  const saved: { current: MatrixPermission<ContentAction>[] } = { current: initial };
  render(<Harness initial={initial} onPermissions={(permissions) => (saved.current = permissions)} />);
  return saved;
};

describe('PermissionMatrix for admin roles', () => {
  it('shows existing per-model and per-field grants, with the every-model row first', async () => {
    renderMatrix([
      { action: 'publish', modelId: null, condition: null, fieldIds: null },
      { action: 'read', modelId: 'm-article', condition: null, fieldIds: null },
      { action: 'update', modelId: 'm-article', condition: null, fieldIds: ['m-article-title'] },
    ]);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('All models')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Publish: All models' })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Read: Article' })).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Update: Article' })).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Read: Note' })).toHaveProperty('ariaChecked', 'false');
    // Six columns, schema changes included; a site's own model names its site.
    expect(screen.getByRole('checkbox', { name: 'Change model: Note' })).toBeTruthy();
    expect(screen.getByText('Blog · note')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Options: Article' }));
    expect(screen.getAllByRole('radio', { name: 'All fields' })).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Title' })).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Notes' })).toHaveProperty('ariaChecked', 'false');
    // Admins see every field, so nothing is marked as hidden.
    expect(screen.queryByText('Hidden by default')).toBeNull();
  });

  it('turns ticks into grants on one model, on one field list, and on every model', async () => {
    const saved = renderMatrix([]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Read: Article' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Update: Article' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Read: All models' }));
    await userEvent.click(screen.getByRole('button', { name: 'Options: Article' }));
    const radios = screen.getAllByRole('radio', { name: 'Only selected fields' });
    // Read, then update: choose fields for update, starting from every live field, then drop Notes.
    await userEvent.click(radios[1] as HTMLElement);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Notes' }));
    expect(saved.current).toEqual([
      { action: 'read', modelId: null, condition: null, fieldIds: null },
      { action: 'read', modelId: 'm-article', condition: null, fieldIds: null },
      { action: 'update', modelId: 'm-article', condition: null, fieldIds: ['m-article-title'] },
    ]);
  });

  it('lists grants on models that no longer exist, to remove', async () => {
    const saved = renderMatrix([
      { action: 'read', modelId: 'm-article', condition: null, fieldIds: null },
      { action: 'delete', modelId: 'm-gone', condition: null, fieldIds: null },
    ]);
    const section = screen.getByRole('region', { name: 'Grants on models that no longer exist' });
    expect(within(section).getByText('m-gone')).toBeTruthy();
    await userEvent.click(within(section).getByRole('button', { name: 'Remove Delete on m-gone' }));
    expect(saved.current).toEqual([
      { action: 'read', modelId: 'm-article', condition: null, fieldIds: null },
    ]);
    expect(screen.queryByRole('region', { name: 'Grants on models that no longer exist' })).toBeNull();
  });

  it('keeps a field list it cannot edit and shows a ticked field the model no longer has', async () => {
    const saved = renderMatrix([
      { action: 'read', modelId: null, condition: null, fieldIds: ['m-article-title'] },
      { action: 'update', modelId: 'm-article', condition: null, fieldIds: ['m-article-gone'] },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Options: All models' }));
    expect(screen.getByText('Only these fields (set through the API): m-article-title')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Options: Article' }));
    const gone = screen.getByRole('checkbox', { name: /m-article-gone/ });
    expect(gone).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByText('Not on this model')).toBeTruthy();
    await userEvent.click(gone);
    expect(saved.current).toEqual([
      { action: 'read', modelId: null, condition: null, fieldIds: ['m-article-title'] },
      { action: 'update', modelId: 'm-article', condition: null, fieldIds: [] },
    ]);
  });
});
