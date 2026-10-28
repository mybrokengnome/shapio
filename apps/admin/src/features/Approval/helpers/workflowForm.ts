import type { ApprovalMode, ApprovalWorkflow, ApprovalWorkflowInput } from '@shapio/client';
import { z } from 'zod';
import type { ValidationMessageKey } from '@/helpers/validation';

/** The server's limits (apps/api routes/schemas/approvalWorkflow.ts `APPROVAL_WORKFLOW_LIMITS`). */
export const APPROVAL_LIMITS = { stages: 10, required: 20, stageName: 100 } as const;

/** One stage as the editor holds it: `required` is the input's text, `stageId` null until the server assigns it. */
export type StageValues = { stageId: string | null; name: string; roleIds: string[]; required: string };

export type WorkflowValues = { stages: StageValues[]; selfApproval: boolean };

/**
 * Both approval settings screens edit this: a site picks `inherit`, `off` or `custom`; the network default is
 * `off` or `custom` (a workflow). The workflow is checked only when `custom` is chosen.
 */
export type ApprovalSettingsValues = { mode: ApprovalMode; workflow: WorkflowValues };

export const newStage = (): StageValues => ({ stageId: null, name: '', roleIds: [], required: '1' });

/** A stored workflow as editor values; none yet gives one empty stage to start from. */
export const workflowValuesOf = (workflow: ApprovalWorkflow | null): WorkflowValues =>
  workflow
    ? {
        stages: workflow.stages.map((stage) => ({
          stageId: stage.id,
          name: stage.name,
          roleIds: [...stage.roleIds],
          required: String(stage.required),
        })),
        selfApproval: workflow.selfApproval,
      }
    : { stages: [newStage()], selfApproval: false };

/** The editor's values as the API takes them: trimmed names, counts as numbers, new stages without an ID. */
export const toWorkflowInput = (workflow: WorkflowValues): ApprovalWorkflowInput => ({
  stages: workflow.stages.map((stage) => ({
    ...(stage.stageId ? { id: stage.stageId } : {}),
    name: stage.name.trim(),
    roleIds: stage.roleIds,
    required: Number(stage.required),
  })),
  selfApproval: workflow.selfApproval,
});

const message = (key: ValidationMessageKey) => key;

const REQUIRED_PATTERN = /^\d+$/;

const isRequiredCount = (value: string) => {
  const trimmed = value.trim();
  const count = Number(trimmed);
  return REQUIRED_PATTERN.test(trimmed) && count >= 1 && count <= APPROVAL_LIMITS.required;
};

/** The server's workflow rules, with messages the form shows inline. Role IDs that no longer exist are refused. */
const workflowSchema = (unknownRoleIds: ReadonlySet<string>) =>
  z.object({
    stages: z
      .array(
        z.object({
          name: z
            .string()
            .trim()
            .min(1, message('validation.required'))
            .max(APPROVAL_LIMITS.stageName, message('validation.tooLong')),
          roleIds: z
            .array(z.string())
            .refine(
              (ids) => !ids.some((id) => unknownRoleIds.has(id)),
              message('validation.approvalDeletedRole'),
            ),
          required: z.string().refine(isRequiredCount, message('validation.approvalRequired')),
        }),
      )
      .min(1)
      .max(APPROVAL_LIMITS.stages),
  });

const stageValuesSchema = z.object({
  stageId: z.string().nullable(),
  name: z.string(),
  roleIds: z.array(z.string()),
  required: z.string(),
});

/**
 * The approval settings form: the workflow is checked against the server's limits only when `custom` is
 * chosen, so a site that inherits or turns approval off saves whatever its hidden workflow holds.
 */
export const approvalSettingsSchema = (unknownRoleIds: readonly string[]) => {
  const unknown = new Set(unknownRoleIds);
  return z
    .object({
      mode: z.enum(['inherit', 'off', 'custom']),
      workflow: z.object({ stages: z.array(stageValuesSchema), selfApproval: z.boolean() }),
    })
    .superRefine((values, context) => {
      if (values.mode !== 'custom') {
        return;
      }
      const result = workflowSchema(unknown).safeParse(values.workflow);
      for (const issue of result.success ? [] : result.error.issues) {
        context.addIssue({ code: 'custom', message: issue.message, path: ['workflow', ...issue.path] });
      }
    });
};
