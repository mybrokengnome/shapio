// @vitest-environment jsdom
import '@/test/dom';
import type { ModelDefinition } from '@shapio/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { useLayoutSwitch } from './useLayoutSwitch';

const mocks = vi.hoisted(() => ({
  active: undefined as unknown as { definition: unknown; version: number },
  plan: vi.fn(),
  ship: vi.fn(),
}));

vi.mock('@/api/schema', () => ({
  definitionQueryOptions: (category: string, id: string) => ({
    queryKey: ['schema', 'definitions', category, id],
    queryFn: () => Promise.resolve(mocks.active),
  }),
  usePlanChange: () => ({ mutateAsync: mocks.plan, isPending: false }),
}));
vi.mock('@/api/changeSets', () => ({
  useShipDraftNow: () => ({ mutateAsync: mocks.ship, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/helpers/reportError', () => ({ logError: vi.fn(), reportError: vi.fn() }));

const product = model({ apiKey: 'product', label: 'Product', fields: [field({ apiKey: 'name' })] });

const quietPlan = {
  plan: {
    summary: { metadataOnly: true, breaking: false, destructive: false },
    prerequisites: [],
    issues: [],
  },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

/** The definition the last ship sent. */
const shipped = (call = -1) => {
  const calls = mocks.ship.mock.calls as [{ input: { definition: ModelDefinition; baseVersion: number } }][];
  return calls.at(call)?.[0].input;
};

describe('useLayoutSwitch', () => {
  beforeEach(() => {
    mocks.active = { definition: product, version: 4 };
    mocks.plan.mockReset().mockResolvedValue(quietPlan);
    mocks.ship.mockReset().mockResolvedValue({ status: 'shipped' });
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('plans and ships the active definition with display.layout set, at its version', async () => {
    const { result } = renderHook(() => useLayoutSwitch(product), { wrapper });
    expect(result.current.layout).toBe('document');
    await act(() => result.current.change('form'));
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.objectContaining({ id: product.id, expectedVersion: 4 }) as unknown,
    );
    expect(shipped()?.baseVersion).toBe(4);
    expect(shipped()?.definition.display.layout).toBe('form');
    expect(shipped()?.definition.fields).toEqual(product.fields);
    expect(toast.success).toHaveBeenCalledWith(
      'Product now opens as a form.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) as unknown }) as unknown,
    );
  });

  it('writes Document as unset, and Undo ships the previous layout without another Undo', async () => {
    const form = { ...product, display: { ...product.display, layout: 'form' as const } };
    mocks.active = { definition: form, version: 7 };
    const { result } = renderHook(() => useLayoutSwitch(form), { wrapper });
    await act(() => result.current.change('document'));
    expect(shipped()?.definition.display).not.toHaveProperty('layout');

    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void };
    };
    mocks.active = { definition: shipped()?.definition, version: 8 };
    act(() => options.action.onClick());
    await vi.waitFor(() => expect(mocks.ship).toHaveBeenCalledTimes(2));
    expect(shipped()?.definition.display.layout).toBe('form');
    expect(shipped()?.baseVersion).toBe(8);
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(vi.mocked(toast.success).mock.calls[1]).toEqual(['Product now opens as a form.', undefined]);
  });

  it('refuses a plan that is not metadata only, and ships nothing', async () => {
    mocks.plan.mockResolvedValue({
      plan: { ...quietPlan.plan, prerequisites: [{ kind: 'checkUnique' }] },
    });
    const { result } = renderHook(() => useLayoutSwitch(product), { wrapper });
    await act(() => result.current.change('form'));
    expect(mocks.ship).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('This change needs a review. Make it in Structure.');
  });
});
