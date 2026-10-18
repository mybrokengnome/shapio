// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusBar } from '.';

type Mocked<T> = { data: T | undefined };

const mocks = vi.hoisted(() => {
  const schema: Mocked<number> = { data: 46 };
  const server: Mocked<{ name: string; version: string; node: string }> = {
    data: { name: 'shapio', version: '0.5.14', node: 'v24.21.0' },
  };
  return { schema, server };
});

vi.mock('@/api/schema', () => ({ useSchemaVersion: () => mocks.schema }));
vi.mock('@/api/system', () => ({ useServerVersion: () => mocks.server }));

describe('StatusBar', () => {
  it('shows the running Shapio version, linked to the changelog, with Node on hover, then the schema', () => {
    render(<StatusBar section="Inbox" />);
    const version = screen.getByRole('link', { name: 'Shapio 0.5.14' });
    expect(version.getAttribute('href')).toBe(
      'https://github.com/mybrokengnome/shapio/blob/main/CHANGELOG.md',
    );
    expect(version.getAttribute('target')).toBe('_blank');
    expect(version.getAttribute('title')).toBe('Running on Node v24.21.0. Opens the changelog.');
    expect(version.closest('p')?.textContent).toBe('Shapio 0.5.14·Schema v46 · live, no restart needed');
  });

  it('shows the schema alone until the version is known', () => {
    mocks.server.data = undefined;
    render(<StatusBar section="Inbox" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Schema v46 · live, no restart needed')).toBeTruthy();
  });
});
