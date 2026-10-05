// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError } from '@shapio/client';
import { SEO_COMPONENT_ID, SEO_EDITOR_ID } from '@shapio/schema';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SeoApi from '@/api/seo';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { useAddSeoField } from './useAddSeoField';

const mocks = vi.hoisted(() => ({
  components: undefined as { definition: { id: string } }[] | undefined,
  canShare: false,
  ensure: vi.fn(),
}));

vi.mock('@/api/schema', () => ({ useDefinitions: () => ({ data: mocks.components }) }));
vi.mock('@/hooks/useSchemaScopeAccess', () => ({
  useSchemaScopeAccess: () => ({ multiSite: false, canShare: mocks.canShare, canCreateOnSite: true }),
}));
vi.mock('@/api/seo', async (original) => ({
  ...(await original<typeof SeoApi>()),
  useEnsureSeoComponent: () => ({ mutateAsync: mocks.ensure, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/helpers/reportError', () => ({ logError: vi.fn(), reportError: vi.fn() }));

const seoComponent = { definition: { id: SEO_COMPONENT_ID } };

type FixtureFields = NonNullable<Parameters<typeof model>[0]>['fields'];

const loadDraft = (fields: FixtureFields = []) =>
  useDefinitionDraftStore.getState().load('model', model({ localized: true, fields }), 1);

const draftFields = () => useDefinitionDraftStore.getState().draft?.fields ?? [];

describe('useAddSeoField', () => {
  beforeEach(() => {
    mocks.components = [];
    mocks.canShare = false;
    mocks.ensure.mockReset();
    vi.mocked(toast.error).mockReset();
    loadDraft();
  });

  it('waits for the site components', () => {
    mocks.components = undefined;
    expect(renderHook(() => useAddSeoField()).result.current.availability).toBe('loading');
  });

  it('adds the field at once when the shared component exists', () => {
    mocks.components = [seoComponent];
    const { result } = renderHook(() => useAddSeoField());
    expect(result.current.availability).toBe('ready');
    act(() => result.current.add());
    expect(draftFields()).toEqual([
      expect.objectContaining({
        apiKey: 'seo',
        localized: true,
        settings: expect.objectContaining({ component: SEO_COMPONENT_ID }) as unknown,
        editor: expect.objectContaining({ id: SEO_EDITOR_ID }) as unknown,
      }),
    ]);
    expect(useDefinitionDraftStore.getState().selection).toEqual({
      type: 'field',
      fieldId: draftFields()[0]?.id,
    });
    expect(result.current.availability).toBe('present');
  });

  it('is unavailable once the model holds the SEO component, whatever its API ID', () => {
    mocks.components = [seoComponent];
    loadDraft([field({ apiKey: 'meta', type: 'component', settings: { component: SEO_COMPONENT_ID } })]);
    expect(renderHook(() => useAddSeoField()).result.current.availability).toBe('present');
  });

  it('asks for a network admin when the component is missing and this admin may not create it', () => {
    expect(renderHook(() => useAddSeoField()).result.current.availability).toBe('askAdmin');
  });

  it('enables SEO for the network, then adds the field', async () => {
    mocks.canShare = true;
    mocks.ensure.mockResolvedValue({ definitionId: SEO_COMPONENT_ID, version: 1, created: true });
    const { result } = renderHook(() => useAddSeoField());
    expect(result.current.availability).toBe('enable');
    await act(() => result.current.enableAndAdd());
    expect(mocks.ensure).toHaveBeenCalledOnce();
    expect(draftFields()).toHaveLength(1);
  });

  it('names the conflicting component and adds nothing', async () => {
    mocks.canShare = true;
    mocks.ensure.mockRejectedValue(
      new ShapioApiError(409, {
        error: {
          code: 'SEO_COMPONENT_CONFLICT',
          message: 'conflict',
          details: { definition: { id: 'x', apiKey: 'seo', label: 'Shared SEO', scope: 'network' } },
        },
      }),
    );
    const { result } = renderHook(() => useAddSeoField());
    await act(() => result.current.enableAndAdd());
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Shared SEO'));
    expect(draftFields()).toEqual([]);
  });
});
