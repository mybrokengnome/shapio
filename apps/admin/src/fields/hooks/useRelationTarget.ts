import { useMemo } from 'react';
import { useResolvedDefinitions } from '@/hooks/useResolvedDefinitions';
import { useFieldsEnvironment } from '../form/context';
import { relationTargetInfoOf, type RelationTargetInfo } from '../helpers/relationTargetLabel';

/** A relation's target inside an entry form: the form's readable models, then the resolved index. */
export const useRelationTarget = (target: string | undefined): RelationTargetInfo => {
  const { models } = useFieldsEnvironment();
  const { resolved } = useResolvedDefinitions();
  const index = resolved?.index;
  return useMemo(
    () => (target === undefined ? { kind: 'unreadable' } : relationTargetInfoOf(target, models, index)),
    [target, models, index],
  );
};
