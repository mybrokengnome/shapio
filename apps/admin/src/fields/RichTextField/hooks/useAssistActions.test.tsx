// @vitest-environment jsdom
import '@/test/dom';
import type { WriteInput } from '@shapio/client';
import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { field, model } from '../../../../../../packages/schema/src/testing/fixtures';
import type { FieldsEnvironment } from '../../form/context';
import { FieldsProvider } from '../../form/FieldsProvider';
import { createEntryFormStore } from '../../form/store';
import { richTextExtensions } from '../extensions';
import { useAssistActions } from './useAssistActions';

const sent: WriteInput[] = [];

vi.mock('@/api/assist', () => ({
  useWriteText: () => ({
    mutate: (input: WriteInput) => sent.push(input),
    reset: () => undefined,
    isPending: false,
    error: null,
  }),
  useRewriteText: () => ({ mutate: () => undefined, reset: () => undefined, isPending: false, error: null }),
}));

const story = model({
  apiKey: 'story',
  fields: [field({ apiKey: 'title' }), field({ apiKey: 'body', type: 'richtext' })],
});
const environment: FieldsEnvironment = {
  idPrefix: 'test-',
  model: story,
  models: new Map([[story.id, story]]),
  components: new Map(),
  locale: 'en',
  entryId: 'entry-1',
  readOnly: false,
  disabled: false,
  runtimeEditors: new Map(),
  pickMedia: () => Promise.resolve(null),
};

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
let editor: Editor;

beforeEach(() => {
  sent.length = 0;
  // "One more" is 0..10, "Two" 10..15.
  editor = new Editor({
    extensions: richTextExtensions(),
    content: { type: 'doc', content: [paragraph('One more'), paragraph('Two')] },
  });
});

afterEach(() => editor.destroy());

const setup = () =>
  renderHook(() => useAssistActions(editor, 'Body'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <FieldsProvider environment={environment} store={createEntryFormStore({ title: 'Harbour' })}>
        {children}
      </FieldsProvider>
    ),
  }).result;

describe('useAssistActions', () => {
  it('continues at the end of the text, wherever the cursor is', () => {
    const result = setup();
    editor.commands.setTextSelection(3);
    act(() => result.current.continueAtEnd());
    expect(sent).toEqual([
      {
        kind: 'continue',
        before: 'One more\n\nTwo',
        title: 'Harbour',
        fieldLabel: 'Body',
        locale: 'en',
      },
    ]);
  });

  it("writes after the cursor's whole block, the context split there", () => {
    const result = setup();
    editor.commands.setTextSelection(4);
    act(() => result.current.writeAtCursor('section'));
    expect(result.current.write.open).toBe(true);
    act(() => result.current.write.setInstruction('A section on pricing'));
    act(() => result.current.write.run());
    expect(sent[0]).toMatchObject({ kind: 'section', before: 'One more', after: 'Two' });
  });
});
