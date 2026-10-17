import { useRouterState, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { LinkedValue } from '@/fields/form/context';
import { linkedValueOf } from '../helpers/linkedValue';

/** The value the URL opened the entry at: `#path` (JSON pointer without its leading slash), `?target=`. */
export const useLinkedValue = (): { linkedValue: LinkedValue | undefined } => {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const { target } = useSearch({ strict: false });
  const linkedValue = useMemo(() => linkedValueOf(hash, target), [hash, target]);
  return { linkedValue };
};
