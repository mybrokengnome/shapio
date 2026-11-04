// @vitest-environment jsdom
import '@/test/dom';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { AssistDocumentContext, useAssistTarget, type AssistDocument } from './assistTarget';
import type { FieldsEnvironment } from './context';
import { FieldsProvider } from './FieldsProvider';
import { createEntryFormStore } from './store';

const article = model({ apiKey: 'article', fields: [field({ apiKey: 'title' })] });
const assistDocument: AssistDocument = { entryId: 'entry-1', saveIfDirty: () => Promise.resolve('ready') };

const environment = (overrides: Partial<FieldsEnvironment>): FieldsEnvironment => ({
  idPrefix: 'test-',
  model: article,
  models: new Map([[article.id, article]]),
  components: new Map(),
  locale: 'en',
  entryId: 'entry-1',
  readOnly: false,
  disabled: false,
  runtimeEditors: new Map(),
  pickMedia: () => Promise.resolve(null),
  ...overrides,
});

const targetIn = (overrides: Partial<FieldsEnvironment>, document: AssistDocument | null = assistDocument) =>
  renderHook(() => useAssistTarget(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AssistDocumentContext.Provider value={document}>
        <FieldsProvider environment={environment(overrides)} store={createEntryFormStore({})}>
          {children}
        </FieldsProvider>
      </AssistDocumentContext.Provider>
    ),
  }).result.current;

describe('useAssistTarget', () => {
  it('is the entry open in the document, in its locale', () => {
    expect(targetIn({})).toMatchObject({ modelKey: 'article', entryId: 'entry-1', locale: 'en' });
  });

  it('is null for a read-only entry, a new entry, or outside the document', () => {
    expect(targetIn({ readOnly: true })).toBeNull();
    expect(targetIn({ entryId: null })).toBeNull();
    expect(targetIn({}, null)).toBeNull();
  });

  it("is null in another form on the page whose entry isn't the document's (an inline-create sheet)", () => {
    expect(targetIn({ entryId: 'entry-2' })).toBeNull();
  });
});
