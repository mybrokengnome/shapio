import type { ValidationIssue } from '@shapio/schema';
import { FieldError } from '@/components/ui/field';
import { describeIssue } from '../../../helpers/describeIssue';

type IssueListProps = { id?: string; issues: readonly ValidationIssue[] };

/** A control's validation problems, translated, under the control (announced via aria-describedby). */
export const IssueList = ({ id, issues }: IssueListProps) => {
  if (issues.length === 0) {
    return null;
  }
  const messages = [...new Set(issues.map(describeIssue))];
  return <FieldError id={id} errors={messages.map((message) => ({ message }))} />;
};
