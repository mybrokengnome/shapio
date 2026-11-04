// @vitest-environment jsdom
import '@/test/dom';
import type { WriteInput, WriteResult } from '@shapio/client';
import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { richTextExtensions } from '../extensions';
import { useWriteProposal } from './useWriteProposal';

const sent: WriteInput[] = [];
const answer: WriteResult = { markdown: 'More text.', model: 'test-model' };

vi.mock('@/api/assist', () => ({
  useWriteText: () => ({
    mutate: (input: WriteInput, options: { onSuccess: (result: WriteResult) => void }) => {
      sent.push(input);
      options.onSuccess(answer);
    },
    reset: () => undefined,
    isPending: false,
    error: null,
  }),
}));

const paragraph = (text?: string) =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };

let editor: Editor;

beforeEach(() => {
  sent.length = 0;
  // "One" is 0..5, the empty paragraph 5..7, "Two" 7..12.
  editor = new Editor({
    extensions: richTextExtensions(),
    content: { type: 'doc', content: [paragraph('One'), paragraph(), paragraph('Two')] },
  });
});

afterEach(() => editor.destroy());

const setup = () =>
  renderHook(() => useWriteProposal(editor, { title: () => 'Harbour', fieldLabel: 'Body', locale: 'en' }));

describe('useWriteProposal', () => {
  it('continues at once with the captured context, the title, the field and the locale', () => {
    const { result } = setup();
    act(() =>
      result.current.start({
        kind: 'continue',
        target: { from: 5, to: 7 },
        context: { before: 'One', after: 'Two' },
      }),
    );
    expect(sent).toEqual([
      { kind: 'continue', before: 'One', after: 'Two', title: 'Harbour', fieldLabel: 'Body', locale: 'en' },
    ]);
    expect(result.current.result).toEqual(answer);
  });

  it('asks for an instruction when there is nothing to continue', () => {
    const { result } = setup();
    act(() =>
      result.current.start({
        kind: 'continue',
        target: { from: 0, to: 0 },
        context: { before: ' ', after: '' },
      }),
    );
    expect(result.current.kind).toBe('section');
    expect(sent).toEqual([]);
    act(() => result.current.setInstruction('A section on pricing'));
    act(() => result.current.run());
    expect(sent[0]).toMatchObject({ kind: 'section', instruction: 'A section on pricing' });
  });

  it('inserts where the target moved to after the person kept writing', () => {
    const { result } = setup();
    act(() =>
      result.current.start({
        kind: 'continue',
        target: { from: 5, to: 7 },
        context: { before: 'One', after: '' },
      }),
    );
    act(() => {
      editor.commands.insertContentAt(1, 'Hey ');
    });
    act(() => result.current.insert([{ type: 'paragraph', content: [{ type: 'text', text: 'Written' }] }]));
    expect(editor.getText({ blockSeparator: '|' })).toBe('Hey One|Written|Two');
    expect(result.current.open).toBe(false);
  });

  it('refuses to insert once the place is gone, and says so', () => {
    const { result } = setup();
    act(() =>
      result.current.start({
        kind: 'continue',
        target: { from: 5, to: 7 },
        context: { before: 'One', after: '' },
      }),
    );
    act(() => {
      editor.commands.deleteRange({ from: 5, to: 7 });
    });
    expect(result.current.stale).toBe(true);
    act(() => result.current.insert([paragraph('Written')]));
    expect(result.current.open).toBe(true);
    expect(editor.getText()).not.toContain('Written');
  });

  it('asks before Escape or a click outside throws away a proposal with text', () => {
    const { result } = setup();
    act(() =>
      result.current.start({
        kind: 'continue',
        target: { from: 5, to: 7 },
        context: { before: 'One', after: '' },
      }),
    );
    act(() => result.current.setHasText(true));
    act(() => result.current.requestClose());
    expect(result.current.confirmingDiscard).toBe(true);
    expect(result.current.open).toBe(true);
    act(() => result.current.keepEditing());
    expect(result.current.confirmingDiscard).toBe(false);
    act(() => result.current.requestClose());
    act(() => result.current.discard());
    expect(result.current.open).toBe(false);
  });

  it('closes at once when the proposal is empty', () => {
    const { result } = setup();
    act(() =>
      result.current.start({
        kind: 'continue',
        target: { from: 5, to: 7 },
        context: { before: 'One', after: '' },
      }),
    );
    act(() => result.current.setHasText(false));
    act(() => result.current.requestClose());
    expect(result.current.open).toBe(false);
  });
});
