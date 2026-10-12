// @vitest-environment jsdom
import '@/test/dom';
import type { EditorContext } from '@shapio/editor-sdk';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { DateInput } from '../DateInput';
import { DateTimeInput } from '../DateTimeInput';
import { fromDateTimeInput } from '../helpers/dates';
import { toEditorField, toEditorModel } from '../helpers/editorContext';
import { isUnparsed } from '../helpers/unparsed';
import { TimeInput } from '../TimeInput';
import type { BuiltInEditorProps } from '../types';

type Case = {
  name: string;
  editor: ComponentType<BuiltInEditorProps>;
  type: 'date' | 'time' | 'datetime';
  /** A saved value, what the input shows for it, and complete text with the value it means. */
  saved: string;
  complete: string;
  completeValue: string | null;
  message: string;
};

const CASES: Case[] = [
  {
    name: 'DateInput',
    editor: DateInput,
    type: 'date',
    saved: '2026-10-11',
    complete: '2026-11-02',
    completeValue: '2026-11-02',
    message: 'Enter a complete date.',
  },
  {
    name: 'TimeInput',
    editor: TimeInput,
    type: 'time',
    saved: '09:30',
    complete: '10:45',
    completeValue: '10:45',
    message: 'Enter a complete time.',
  },
  {
    name: 'DateTimeInput',
    editor: DateTimeInput,
    type: 'datetime',
    saved: '2026-10-11T08:00:00.000Z',
    complete: '2026-11-02T10:45:00',
    completeValue: fromDateTimeInput('2026-11-02T10:45:00', false),
    message: 'Enter a complete date and time.',
  },
];

/** The browser's verdict on what is typed: jsdom never reports a partly typed value, so it is set here. */
const setBadInput = (input: HTMLInputElement, badInput: boolean) =>
  Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput }) });

describe.each(CASES)('$name', ({ editor: Editor, type, saved, complete, completeValue, message }) => {
  const owner = model({ fields: [field({ apiKey: 'when', label: 'When', type })] });
  const definition = owner.fields[0]!;

  /** The editor inside a form that holds its value, as the entry store does. */
  const Form = ({
    initial,
    onChange,
    onBlur,
  }: {
    initial: unknown;
    onChange: (value: unknown) => void;
    onBlur?: () => void;
  }) => {
    const [value, setValue] = useState(initial);
    const props: BuiltInEditorProps = {
      inputId: 'field-when',
      labelId: 'field-when-label',
      describedBy: undefined,
      value,
      onChange: (next) => {
        onChange(next);
        setValue(next);
      },
      onBlur: onBlur ?? (() => {}),
      validation: { errors: [], invalid: false },
      readOnly: false,
      disabled: false,
      field: toEditorField(definition),
      model: toEditorModel(owner),
      context: {} as EditorContext,
      definition,
      path: '/when',
    };
    return (
      <>
        <Editor {...props} />
        <button type="button" onClick={() => props.onChange(null)}>
          outside
        </button>
      </>
    );
  };

  const input = () => document.getElementById('field-when') as HTMLInputElement;

  it('keeps a partly typed value as unparsed text instead of clearing the saved one', () => {
    const onChange = vi.fn();
    render(<Form initial={saved} onChange={onChange} />);
    setBadInput(input(), true);
    fireEvent.change(input(), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(isUnparsed(onChange.mock.lastCall?.[0])).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toContain('field-when-parse');
    expect(screen.getByRole('button', { name: 'Clear When' })).toBeTruthy();
  });

  it('notices partial typing in an empty box on a key press, which changes no value', () => {
    const onChange = vi.fn();
    render(<Form initial={null} onChange={onChange} />);
    setBadInput(input(), true);
    fireEvent.keyUp(input(), { key: '1' });
    expect(isUnparsed(onChange.mock.lastCall?.[0])).toBe(true);
    // Further keys while it is still partial report nothing new.
    fireEvent.keyUp(input(), { key: '0' });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reports the value once it is complete, and the message goes', () => {
    const onChange = vi.fn();
    render(<Form initial={saved} onChange={onChange} />);
    setBadInput(input(), true);
    fireEvent.change(input(), { target: { value: '' } });
    setBadInput(input(), false);
    fireEvent.change(input(), { target: { value: complete } });
    expect(onChange).toHaveBeenLastCalledWith(completeValue);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads the box again on blur, then tells the form', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<Form initial={null} onChange={onChange} onBlur={onBlur} />);
    setBadInput(input(), true);
    fireEvent.blur(input());
    expect(isUnparsed(onChange.mock.lastCall?.[0])).toBe(true);
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it('clears on purpose: the input emptied by the person, or the Clear button', () => {
    const onChange = vi.fn();
    render(<Form initial={saved} onChange={onChange} />);
    setBadInput(input(), false);
    fireEvent.change(input(), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.change(input(), { target: { value: complete } });
    setBadInput(input(), true);
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear When' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('empties the box when the form drops the partial value from outside (reload, discard)', () => {
    render(<Form initial={saved} onChange={() => {}} />);
    setBadInput(input(), true);
    fireEvent.change(input(), { target: { value: '' } });
    const assigned = vi.fn();
    Object.defineProperty(input(), 'value', { configurable: true, get: () => '', set: assigned });
    fireEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(assigned).toHaveBeenCalledWith('');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
