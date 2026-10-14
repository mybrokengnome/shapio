// @vitest-environment jsdom
import '@/test/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { FormBody } from '@/features/Content/Entry/Form';
import { PropertyValue } from '@/features/Content/Entry/PropertyValue';
import type { FieldsEnvironment } from '@/fields/form/context';
import { FieldsProvider } from '@/fields/form/FieldsProvider';
import { createEntryFormStore } from '@/fields/form/store';
import { defaultFormValues } from '@/fields/helpers/formValues';
import { field, id, model } from '../../../../../packages/schema/src/testing/fixtures';

/** A model this role can't read: present in the schema, absent from the admin's readable registry. */
const HIDDEN_MODEL = id(9);
const WRITER = id(2);
const article = model({
  display: { layout: 'form', titleFieldId: id(1) },
  fields: [
    field({ id: id(1), apiKey: 'title', label: 'Title' }),
    field({
      id: WRITER,
      apiKey: 'writer',
      label: 'Writer',
      type: 'relation',
      settings: { target: HIDDEN_MODEL, cardinality: 'one' },
    }),
  ],
});
const writer = article.fields[1]!;

const environment: FieldsEnvironment = {
  idPrefix: 'test-',
  model: article,
  models: new Map([[article.id, article]]),
  components: new Map(),
  locale: null,
  entryId: null,
  readOnly: false,
  disabled: false,
  runtimeEditors: new Map(),
  pickMedia: () => Promise.resolve(null),
};

const renderWith = (children: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FieldsProvider
        environment={environment}
        store={createEntryFormStore({ ...defaultFormValues(article.fields), writer: id(7) })}
      >
        {children}
      </FieldsProvider>
    </QueryClientProvider>,
  );

describe('a relation to a content type this role cannot read', () => {
  it('says the content type is not readable, not that it was deleted', () => {
    renderWith(<FormBody model={article} heading="Article" />);
    expect(screen.getByText("You can't read the content type this field links to.")).toBeTruthy();
    expect(screen.queryByText(/no longer exists/)).toBeNull();
  });

  it('summarizes the linked entries without pretending they are untitled', () => {
    renderWith(<PropertyValue field={writer} value={id(7)} />);
    expect(screen.getByText("1 linked entry you can't read")).toBeTruthy();
    expect(screen.queryByText(/Untitled/)).toBeNull();
  });
});
