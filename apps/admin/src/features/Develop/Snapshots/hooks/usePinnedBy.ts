import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';
import { usePrincipalUsage } from '@/api/usage';
import { useDevelopPermissions } from '../../Changes/hooks/useDevelopPermissions';
import { usePrincipalLabel } from '../../Changes/hooks/usePrincipalLabel';

/**
 * Which readers last pinned each snapshot (`?snapshot=N` in their requests), from the usage counters.
 * Empty without `tokens.manage`.
 */
export const usePinnedBy = () => {
  const { canReadUsage } = useDevelopPermissions();
  const principalLabel = usePrincipalLabel();
  const models = useDefinitions('model');
  const modelIds = useMemo(() => (models.data ?? []).map(({ definition }) => definition.id), [models.data]);
  const { principals } = usePrincipalUsage(modelIds, canReadUsage);
  const bySeq = new Map<number, string[]>();
  for (const principal of principals) {
    if (principal.lastSnapshot !== null) {
      const names = bySeq.get(principal.lastSnapshot) ?? [];
      names.push(principalLabel(principal.principalKey, principal.tokenName));
      bySeq.set(principal.lastSnapshot, names);
    }
  }
  return { canReadUsage, pinnedBy: (seq: number) => bySeq.get(seq) ?? [] };
};
