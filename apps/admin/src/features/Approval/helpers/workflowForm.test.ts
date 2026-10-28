import { describe, expect, it } from 'vitest';
import {
  approvalSettingsSchema,
  newStage,
  toWorkflowInput,
  workflowValuesOf,
  type ApprovalSettingsValues,
  type StageValues,
} from './workflowForm';

const stage = (overrides: Partial<StageValues> = {}): StageValues => ({
  ...newStage(),
  name: 'Legal',
  ...overrides,
});

const values = (stages: StageValues[], mode: ApprovalSettingsValues['mode'] = 'custom') => ({
  mode,
  workflow: { stages, selfApproval: false },
});

/** The messages the form would show, by field path. */
const issuesOf = (input: ApprovalSettingsValues, unknownRoleIds: string[] = []) => {
  const result = approvalSettingsSchema(unknownRoleIds).safeParse(input);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
};

describe('approvalSettingsSchema (plan approval-workflows)', () => {
  it('accepts a workflow inside the server limits', () => {
    expect(
      issuesOf(values([stage(), stage({ name: 'Publisher', required: '20', roleIds: ['r1'] })])),
    ).toEqual({});
  });

  it('needs a stage name, at most 100 characters', () => {
    expect(issuesOf(values([stage({ name: '   ' })]))).toEqual({
      'workflow.stages.0.name': 'validation.required',
    });
    expect(issuesOf(values([stage({ name: 'x'.repeat(101) })]))).toEqual({
      'workflow.stages.0.name': 'validation.tooLong',
    });
  });

  it('needs a whole number of sign-offs from 1 to 20', () => {
    for (const required of ['0', '21', '1.5', '', 'two', '-1']) {
      expect(issuesOf(values([stage({ required })]))).toEqual({
        'workflow.stages.0.required': 'validation.approvalRequired',
      });
    }
  });

  it('refuses a role that was deleted until it is unchecked', () => {
    expect(issuesOf(values([stage({ roleIds: ['gone', 'kept'] })]), ['gone'])).toEqual({
      'workflow.stages.0.roleIds': 'validation.approvalDeletedRole',
    });
  });

  it('needs one to ten stages', () => {
    expect(issuesOf(values([]))).toHaveProperty(['workflow.stages']);
    expect(issuesOf(values(Array.from({ length: 11 }, () => stage())))).toHaveProperty(['workflow.stages']);
    expect(issuesOf(values(Array.from({ length: 10 }, () => stage())))).toEqual({});
  });

  it('checks nothing in the workflow unless a workflow is chosen', () => {
    const broken = [stage({ name: '', required: '0', roleIds: ['gone'] })];
    expect(issuesOf(values(broken, 'inherit'), ['gone'])).toEqual({});
    expect(issuesOf(values(broken, 'off'), ['gone'])).toEqual({});
  });
});

describe('workflow values', () => {
  it('start from one empty stage when there is no workflow', () => {
    expect(workflowValuesOf(null)).toEqual({ stages: [newStage()], selfApproval: false });
  });

  it('round-trip a stored workflow, trimming names and keeping stage IDs; new stages have none', () => {
    const editorValues = workflowValuesOf({
      stages: [{ id: 'legal', name: 'Legal', roleIds: ['r1'], required: 2 }],
      selfApproval: true,
    });
    editorValues.stages.push(stage({ name: '  Publisher ' }));
    expect(toWorkflowInput(editorValues)).toEqual({
      stages: [
        { id: 'legal', name: 'Legal', roleIds: ['r1'], required: 2 },
        { name: 'Publisher', roleIds: [], required: 1 },
      ],
      selfApproval: true,
    });
  });
});
