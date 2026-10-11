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
import { JsonEditor } from '.';

const owner = model({ fields: [field({ apiKey: 'meta', label: 'Meta', type: 'json' })] });
const definition = owner.fields[0]!;

/** The editor inside a form that holds its value, as the entry store does. */
const Form = ({ initial, onChange }: { initial: unknown; onChange: (value: unknown) => void }) => {
  const [value, setValue] = useState(initial);
  const props: BuiltInEditorProps = {
    inputId: 'field-meta',
    labelId: 'field-meta-label',
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
    path: '/meta',
  };
  return <JsonEditor {...props} />;
};

const type = (text: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });

describe('JsonEditor', () => {
  it('reports text that is not JSON to the form as unparsed text, with the reason inline', () => {
    const onChange = vi.fn();
    render(<Form initial={{ a: 1 }} onChange={onChange} />);
    type('{bad json');
    const reported: unknown = onChange.mock.lastCall?.[0];
    expect(isUnparsed(reported)).toBe(true);
    expect((reported as { text: string }).text).toBe('{bad json');
    expect(screen.getByRole('alert').textContent).toMatch(/^Not valid JSON: /);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Format' }).hasAttribute('disabled')).toBe(true);
  });

  it('reports the parsed value again once the text is JSON, and the error goes', () => {
    const onChange = vi.fn();
    render(<Form initial={null} onChange={onChange} />);
    type('{bad');
    type('{"good": true}');
    expect(onChange).toHaveBeenLastCalledWith({ good: true });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('{"good": true}');
  });

  it('shows unparsed text from the form as typed when it mounts again', () => {
    render(<Form initial={unparsedText('[1,')} onChange={() => {}} />);
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('[1,');
    expect(screen.getByRole('alert').textContent).toMatch(/^Not valid JSON: /);
  });
});
