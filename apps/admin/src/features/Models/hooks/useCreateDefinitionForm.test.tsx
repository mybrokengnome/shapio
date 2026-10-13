// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError } from '@shapio/client';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateDefinitionForm } from './useCreateDefinitionForm';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  navigate: vi.fn(),
  models: [] as Array<{ definition: unknown; scope: 'site' | 'network'; siteId: string | null }>,
}));

// A real mutation, so `createDefinition.error` is only fresh on the render after the failure, as in the app.
vi.mock('@/api/schema', () => ({
  useCreateDefinition: () => useMutation({ mutationFn: mocks.create }),
  useAllDefinitions: () => ({ definitions: [] }),
  useDefinitions: () => ({ data: mocks.models }),
}));
vi.mock('@/api/auth', () => ({ useMe: () => ({ data: { site: { id: 'site-1' } } }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const refusal = (issues: Array<{ path: string; code: string; message: string }>) =>
  new ShapioApiError(422, {
    error: { code: 'SCHEMA_INVALID', message: 'The schema is invalid', details: { issues } },
  });

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const submitQuery = async () => {
  const { result } = renderHook(() => useCreateDefinitionForm('collection'), { wrapper });
  act(() => {
    result.current.form.setValue('label', 'Query');
    result.current.form.setValue('apiKey', 'query');
    result.current.form.setValue('pluralApiKey', 'queries');
  });
  await act(() => result.current.onSubmit());
  return result;
};

describe('useCreateDefinitionForm', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.navigate.mockReset();
    mocks.models = [];
  });

  it('shows the server reason on the API ID the first time a create is refused', async () => {
    mocks.create.mockRejectedValue(
      refusal([{ path: '/apiKey', code: 'API_KEY_RESERVED', message: 'generates the GraphQL type "Query"' }]),
    );
    const result = await submitQuery();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(result.current.form.getFieldState('apiKey').error?.message).toBe(
      'This name is reserved. Choose another.',
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ShapioApiError));
    expect(result.current.errorMessage).toBeUndefined();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows a refusal that points at no field on the form as the form error', async () => {
    mocks.create.mockRejectedValue(
      refusal([{ path: '', code: 'SOMETHING_NEW', message: 'Too many models.' }]),
    );
    const result = await submitQuery();
    await waitFor(() => expect(result.current.errorMessage).toBe('Too many models.'));
    expect(result.current.form.getFieldState('apiKey').error).toBeUndefined();
  });

  it('creates a kind with its parent and the parent’s flags, and shows a refused parent on Extends', async () => {
    mocks.models = [
      {
        definition: {
          id: 'products',
          kind: 'collection',
          apiKey: 'product',
          pluralApiKey: 'products',
          label: 'Products',
          localized: true,
          draftAndPublish: false,
          fields: [],
          display: {},
        },
        scope: 'site',
        siteId: 'site-1',
      },
    ];
    mocks.create.mockRejectedValue(
      refusal([{ path: '/extends', code: 'INVALID_PARENT', message: 'can only extend a collection' }]),
    );
    const { result } = renderHook(() => useCreateDefinitionForm('collection'), { wrapper });
    expect(result.current.parentChoices.map((choice) => choice.id)).toEqual(['products']);
    act(() => {
      result.current.form.setValue('label', 'Digital');
      result.current.form.setValue('apiKey', 'digitalProduct');
      result.current.form.setValue('pluralApiKey', 'digital');
      result.current.form.setValue('extends', 'products');
    });
    await waitFor(() => expect(result.current.form.getValues('localized')).toBe(true));
    await act(() => result.current.onSubmit());
    const [variables] = mocks.create.mock.calls[0] as [{ input: { definition: Record<string, unknown> } }];
    expect(variables.input.definition).toMatchObject({
      extends: 'products',
      localized: true,
      draftAndPublish: false,
    });
    expect(result.current.form.getFieldState('extends').error?.message).toBe(
      'Only a collection can extend another, and only one available in the same place (this site or all sites).',
    );
  });
});
