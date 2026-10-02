import type { ValidationIssue } from '@shapio/schema';
import { describedBy } from '@/helpers/describedBy';

/** What every builder control takes besides its value: a label, an optional hint and its issues. */
export type ControlBaseProps = {
  id: string;
  label: string;
  /** An explanation behind an info icon beside the label (DESIGN.md, helper-text rule). */
  hint?: string;
  /** One visible line under the control, only when it changes what the person does (a warning). */
  description?: string;
  issues?: readonly ValidationIssue[];
  disabled?: boolean;
};

/** The IDs of a control's hint, description and error elements, and the `aria-describedby` joining them. */
export const controlIds = (
  id: string,
  { hint, description, issues = [] }: Pick<ControlBaseProps, 'hint' | 'description' | 'issues'>,
) => {
  const hintId = hint ? `${id}-hint` : undefined;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = issues.length > 0 ? `${id}-error` : undefined;
  return { hintId, descriptionId, errorId, describedBy: describedBy(hintId, descriptionId, errorId) };
};
