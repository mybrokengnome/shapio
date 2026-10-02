import type { ReviewIssue } from '@shapio/client';

type IssueListProps = { issues: readonly ReviewIssue[] };

/** Review issues as a bulleted list of their messages. */
export const IssueList = ({ issues }: IssueListProps) => (
  <ul className="list-disc space-y-1 pl-4">
    {issues.map((issue) => (
      <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>
    ))}
  </ul>
);
