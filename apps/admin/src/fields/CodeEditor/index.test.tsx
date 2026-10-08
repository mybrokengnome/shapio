// @vitest-environment jsdom
import '@/test/dom';
import { language } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { EditorContext } from '@shapio/editor-sdk';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { toEditorField, toEditorModel } from '../helpers/editorContext';
import type { BuiltInEditorProps } from '../types';
import { CodeEditor } from '.';

const owner = model({
  fields: [
    field({
      apiKey: 'config',
      label: 'Config',
      type: 'code',
      settings: { language: 'json', validate: true },
    }),
  ],
});
const definition = owner.fields[0]!;

const propsWith = (overrides: Partial<BuiltInEditorProps> = {}): BuiltInEditorProps => ({
  inputId: 'field-config',
  labelId: 'field-config-label',
  describedBy: undefined,
  value: null,
  onChange: () => {},
  onBlur: () => {},
  validation: { errors: [], invalid: false },
  readOnly: false,
  disabled: false,
  field: toEditorField(definition),
  model: toEditorModel(owner),
  context: {} as EditorContext,
  definition,
  path: '/config',
  ...overrides,
});

const renderEditor = (props: BuiltInEditorProps) => {
  const result = render(<CodeEditor {...props} />);
  const content = result.container.querySelector<HTMLElement>('.cm-content');
  const view = content ? EditorView.findFromDOM(content) : null;
  if (!content || !view) {
    throw new Error('CodeMirror did not mount');
  }
  return { ...result, content, view };
};

describe('CodeEditor', () => {
  it('puts the field ids and a tab stop on the editable content', () => {
    const { content } = renderEditor(propsWith({ describedBy: 'field-config-errors' }));
    expect(content.id).toBe('field-config');
    expect(content.getAttribute('aria-labelledby')).toBe('field-config-label');
    expect(content.getAttribute('aria-describedby')).toBe('field-config-errors field-config-keys');
    expect(content.getAttribute('tabindex')).toBe('0');
  });

  it('reports the text as typed, and an emptied editor as null', () => {
    const onChange = vi.fn();
    const { view } = renderEditor(propsWith({ onChange }));
    view.dispatch({ changes: { from: 0, insert: ' {"a": 1}\n' } });
    expect(onChange).toHaveBeenLastCalledWith(' {"a": 1}\n');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('follows outside value changes without reporting them as edits', () => {
    const onChange = vi.fn();
    const props = propsWith({ value: '{}', onChange });
    const { view, rerender } = renderEditor(props);
    expect(view.state.doc.toString()).toBe('{}');
    rerender(<CodeEditor {...props} value={'{"restored": true}'} />);
    expect(view.state.doc.toString()).toBe('{"restored": true}');
    rerender(<CodeEditor {...props} value={null} />);
    expect(view.state.doc.toString()).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is read-only when the field is, and says so', () => {
    const props = propsWith({ value: '{}' });
    const { view, content, rerender } = renderEditor(props);
    expect(view.state.readOnly).toBe(false);
    rerender(<CodeEditor {...props} readOnly />);
    expect(view.state.readOnly).toBe(true);
    expect(content.getAttribute('aria-readonly')).toBe('true');
  });

  it('marks the content invalid when the field has errors', () => {
    const { content } = renderEditor(
      propsWith({ validation: { errors: ['Must be valid JSON.'], invalid: true } }),
    );
    expect(content.getAttribute('aria-invalid')).toBe('true');
  });

  it('loads the field language and reconfigures the running editor with it', async () => {
    const { view } = renderEditor(propsWith({ value: '{"a": 1}' }));
    await waitFor(() => expect(view.state.facet(language)?.name).toBe('json'));
  });
});
