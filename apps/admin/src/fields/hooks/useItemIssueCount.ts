import { useMemo } from 'react';
import { useEntryForm } from '../form/context';
import { countIssuesUnder, issuesByPath } from '../helpers/issues';

/** Server issues at or below a path (shown on collapsed items so problems are never hidden). */
export const useItemIssueCount = (path: string): number => {
  const issues = useEntryForm((state) => state.issues);
  return useMemo(() => countIssuesUnder(issuesByPath(issues), path), [issues, path]);
};
