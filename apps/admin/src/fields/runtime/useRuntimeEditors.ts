import { useQuery } from '@tanstack/react-query';
import { useEditorManifest } from '@/api/editors';
import { loadRuntimeEditors, NO_RUNTIME_EDITORS, type RuntimeEditors } from './loader';

/** The project's custom editors, imported once per session (they change only with a server restart). */
export const useRuntimeEditors = (): RuntimeEditors & { isLoading: boolean } => {
  const manifest = useEditorManifest();
  const modules = useQuery({
    queryKey: ['extensions', 'editors', 'modules', manifest.data ?? null],
    queryFn: () => loadRuntimeEditors(manifest.data ?? { items: [] }),
    enabled: manifest.data !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    meta: { silent: true },
  });
  return {
    ...(modules.data ?? NO_RUNTIME_EDITORS),
    isLoading: manifest.isPending || (manifest.data !== undefined && modules.isPending),
  };
};
