// @vitest-environment jsdom
import '@/test/dom';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FieldsEnvironment } from '@/fields/form/context';
import { FieldsProvider } from '@/fields/form/FieldsProvider';
import { createEntryFormStore } from '@/fields/form/store';
import { defaultFormValues } from '@/fields/helpers/formValues';
import { field, id, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { FormBody } from '.';

const NAME = id(1);
const PRICE = id(2);
const SKU = id(3);
const NOTES = id(4);

const product = model({
  display: {
    layout: 'form',
    titleFieldId: NAME,
    groups: [{ id: 'pricing', label: 'Pricing', fieldIds: [PRICE, SKU] }],
  },
  fields: [
    field({ id: NAME, apiKey: 'name', label: 'Name' }),
    field({ id: PRICE, apiKey: 'price', label: 'Price', type: 'decimal', width: 'half' }),
    field({ id: SKU, apiKey: 'sku', label: 'SKU', width: 'half' }),
    field({ id: NOTES, apiKey: 'notes', label: 'Notes', type: 'text', width: 'two-thirds' }),
  ],
});

const environment: FieldsEnvironment = {
  idPrefix: 'test-',
  model: product,
  models: new Map([[product.id, product]]),
  components: new Map(),
  locale: null,
  entryId: null,
  readOnly: false,
  disabled: false,
  runtimeEditors: new Map(),
  pickMedia: () => Promise.resolve(null),
};

const renderForm = () =>
  render(
    <FieldsProvider environment={environment} store={createEntryFormStore(defaultFormValues(product.fields))}>
      <FormBody model={product} heading="Blue mug" />
    </FieldsProvider>,
  );

const sectionOf = (path: string) => document.querySelector(`[data-field-path="${path}"]`);

describe('FormBody', () => {
  it('shows the title as a read-only heading and edits it as a field of the form', () => {
    renderForm();
    expect(screen.getByRole('heading', { level: 1, name: 'Blue mug' }).className).toContain('text-title');
    expect(screen.getByRole('textbox', { name: /Name/ })).toBeTruthy();
  });

  it('lays the fields out in sections, labelled groups under their heading', () => {
    renderForm();
    const pricing = screen.getByRole('region', { name: 'Pricing' });
    expect(within(pricing).getByText('Price')).toBeTruthy();
    expect(within(pricing).getByText('SKU')).toBeTruthy();
    expect(within(pricing).queryByText('Name')).toBeNull();
    // Field order decides: name, then the Pricing group, then the ungrouped notes in a section of their own.
    const sections = [...document.querySelectorAll('section[data-form-section]')];
    expect(sections.map((section) => section.querySelector('h2')?.textContent ?? null)).toEqual([
      null,
      'Pricing',
      null,
    ]);
    expect(within(sections[2] as HTMLElement).getByText('Notes')).toBeTruthy();
    // Only the unlabelled section after the group gets extra space above; no section has a line without text.
    expect(sections.map((section) => section.classList.contains('pt-8'))).toEqual([false, false, true]);
    expect(sections[2]?.querySelector('[aria-hidden="true"].h-px')).toBeNull();
  });

  it('spans each field by its width', () => {
    renderForm();
    expect(sectionOf('/name')?.classList.contains('@lg:col-span-6')).toBe(true);
    expect(sectionOf('/price')?.classList.contains('@lg:col-span-3')).toBe(true);
    expect(sectionOf('/sku')?.classList.contains('@lg:col-span-3')).toBe(true);
    expect(sectionOf('/notes')?.classList.contains('@lg:col-span-4')).toBe(true);
  });
});
