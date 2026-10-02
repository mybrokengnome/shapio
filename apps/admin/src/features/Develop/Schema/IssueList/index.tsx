import type { ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';

type IssueListProps = { issues: readonly ValidationIssue[]; id?: string };

/**
 * The open file's problems as text outside the editor (the editor marks them inline too), so they are
 * readable without hovering and announced to screen readers.
 */
export const IssueList = ({ issues, id }: IssueListProps) => {
  const { t } = useTranslation();
  if (issues.length === 0) {
    return null;
  }
  return (
    <div
      id={id}
      role="status"
      className="space-y-1.5 rounded-lg border border-destructive/40 bg-destructive-muted p-3"
    >
      <p className="text-sm font-semibold text-destructive">
        {t('develop.schema.problems', { count: issues.length })}
      </p>
      <ul className="space-y-1 text-meta text-foreground">
        {issues.map((issue) => (
          <li key={`${issue.path}:${issue.code}:${issue.message}`} className="break-words">
            <code className="font-mono text-xs">{issue.path || '/'}</code> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
};
