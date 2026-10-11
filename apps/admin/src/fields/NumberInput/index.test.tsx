// @vitest-environment jsdom
import '@/test/dom';
import type { EditorContext } from '@shapio/editor-sdk';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { toEditorField, toEditorModel } from '../helpers/editorContext';
import { isUnparsed, unparsedText } from '../helpers/unparsed';
import type { BuiltInEditorProps } from '../types';
import { NumberInput } from '.';

const owner = model({ fields: [field({ apiKey: 'views', label: 'Views', type: 'integer' })] });
const definition = owner.fields[0]!;

/** The editor inside a form that holds its value, as the entry store does. */
const Form = ({ initial, onChange }: { initial: unknown; onChange: (value: unknown) => void }) => {
  const [value, setValue] = useState(initial);
  const props: BuiltInEditorProps = {
    inputId: 'field-views',
    labelId: 'field-views-label',
    describedBy: undefined,
    value,
    onChange: (next) => {
      onChange(next);
      setValue(next);
    },
    onBlur: () => {},
    validation: { errors: [], invalid: false },
    readOnly: false,
    disabled: false,
    field: toEditorField(definition),
    model: toEditorModel(owner),
    context: {} as EditorContext,
    definition,
    path: '/views',
  };
  return <NumberInput {...props} />;
};

const type = (text: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });

describe('NumberInput', () => {
  it('reports text that does not parse to the form as unparsed text, never a stale number', () => {
    const onChange = vi.fn();
    render(<Form initial={5} onChange={onChange} />);
    type('5x');
    const reported: unknown = onChange.mock.lastCall?.[0];
    expect(isUnparsed(reported)).toBe(true);
    expect((reported as { text: string }).text).toBe('5x');
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole number.');
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('5x');
  });

  it('reports the number again once the text parses, and the error goes', () => {
    const onChange = vi.fn();
    render(<Form initial={null} onChange={onChange} />);
    type('3.7');
    type('37');
    expect(onChange).toHaveBeenLastCalledWith(37);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows unparsed text from the form as typed when it mounts again', () => {
    render(<Form initial={unparsedText('12abc')} onChange={() => {}} />);
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('12abc');
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole number.');
  });
});
