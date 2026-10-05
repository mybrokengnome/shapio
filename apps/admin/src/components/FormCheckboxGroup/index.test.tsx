// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { FormCheckboxGroup } from '.';

type Values = { actions: string[] };

const Group = () => {
  const form = useForm<Values>({ defaultValues: { actions: ['read'] } });
  return (
    <FormCheckboxGroup
      control={form.control}
      name="actions"
      legend="Content"
      options={[
        { value: 'read', label: 'Read entries' },
        { value: 'readDrafts', label: 'Read drafts', hint: 'For development servers.' },
      ]}
    />
  );
};

describe('FormCheckboxGroup', () => {
  it('puts an option hint behind an info icon and links it to that checkbox only', () => {
    render(<Group />);
    expect(screen.getByRole('button', { name: 'More about Read drafts' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More about Read entries' })).toBeNull();
    const drafts = screen.getByRole('checkbox', { name: 'Read drafts' });
    expect(drafts.getAttribute('aria-describedby')).toBe('field-actions-readDrafts-hint');
    expect(document.getElementById('field-actions-readDrafts-hint')?.textContent).toBe(
      'For development servers.',
    );
    expect(screen.getByRole('checkbox', { name: 'Read entries' }).hasAttribute('aria-describedby')).toBe(
      false,
    );
  });
});
