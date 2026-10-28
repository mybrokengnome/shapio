import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import type { AdminPrincipal, TokenPrincipal } from '../permissions/types.js';
import { ApprovalWorkflowInputSchema, ApprovalWorkflowSchema } from '../routes/schemas/approvalWorkflow.js';
import {
  effectiveOf,
  ineligibleReason,
  nextReviewStep,
  normalizeWorkflow,
  parseStoredWorkflow,
  type EligibilityInput,
} from './approvalWorkflows.js';
import { isReviewOutdated } from './changeSetFingerprint.js';

const EDITOR = '11111111-1111-4111-8111-111111111111';
const LEGAL = '22222222-2222-4222-8222-222222222222';
const SITE = 'site-a';

const admin = (
  id: string,
  assignments: Array<{ roleId: string; siteId: string | null }>,
): AdminPrincipal => ({
  kind: 'admin',
  adminUserId: id,
  sessionId: 's',
  assignments,
  siteId: SITE,
  roleIds: assignments.filter((a) => a.siteId === null || a.siteId === SITE).map((a) => a.roleId),
  networkRoleIds: assignments.filter((a) => a.siteId === null).map((a) => a.roleId),
});

const token = (roleId: string): TokenPrincipal => ({
  kind: 'token',
  tokenId: 'token-1',
  scope: 'admin',
  roleId,
  siteId: SITE,
});

const stage = { id: 'legal', name: 'Legal', roleIds: [LEGAL], required: 2 };
const none = { adminUserId: null, apiTokenId: null };

const input = (overrides: Partial<EligibilityInput>): EligibilityInput => ({
  principal: admin('reviewer', [{ roleId: LEGAL, siteId: SITE }]),
  stage,
  selfApproval: false,
  knownRoleIds: new Set([EDITOR, LEGAL]),
  creator: { adminUserId: 'author', apiTokenId: null },
  requester: { adminUserId: 'author', apiTokenId: null },
  signers: [],
  outdated: false,
  decision: 'approve',
  ...overrides,
});

describe('workflow schema', () => {
  const valid = { stages: [{ name: 'Editorial', roleIds: [EDITOR], required: 1 }] };

  it('accepts a workflow within bounds', () => {
    expect(Value.Check(ApprovalWorkflowInputSchema, valid)).toBe(true);
  });

  it('refuses no stages, more than ten, a blank name, required out of 1..20 and repeated roles', () => {
    const stages = (count: number) => Array.from({ length: count }, () => valid.stages[0]);
    const bad = [
      { stages: [] },
      { stages: stages(11) },
      { stages: [{ name: '   ', roleIds: [], required: 1 }] },
      { stages: [{ name: 'x'.repeat(101), roleIds: [], required: 1 }] },
      { stages: [{ name: 'A', roleIds: [], required: 0 }] },
      { stages: [{ name: 'A', roleIds: [], required: 21 }] },
      { stages: [{ name: 'A', roleIds: [EDITOR, EDITOR], required: 1 }] },
      { stages: [{ name: 'A', roleIds: ['not-a-uuid'], required: 1 }] },
      { ...valid, extra: true },
    ];
    for (const workflow of bad) {
      expect(Value.Check(ApprovalWorkflowInputSchema, workflow), JSON.stringify(workflow)).toBe(false);
    }
    expect(Value.Check(ApprovalWorkflowInputSchema, { stages: stages(10) })).toBe(true);
  });

  it('assigns IDs to new stages, keeps given ones, trims names and defaults selfApproval to false', () => {
    const workflow = normalizeWorkflow({
      stages: [
        { id: 'kept', name: ' Editorial ', roleIds: [], required: 1 },
        { name: 'Legal', roleIds: [LEGAL], required: 2 },
      ],
    });
    expect(workflow.selfApproval).toBe(false);
    expect(workflow.stages[0]).toEqual({ id: 'kept', name: 'Editorial', roleIds: [], required: 1 });
    expect(workflow.stages[1]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Value.Check(ApprovalWorkflowSchema, workflow)).toBe(true);
  });

  it('refuses two stages with one ID', () => {
    expect(() =>
      normalizeWorkflow({
        stages: [
          { id: 'same', name: 'A', roleIds: [], required: 1 },
          { id: 'same', name: 'B', roleIds: [], required: 1 },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'APPROVAL_WORKFLOW_INVALID' }));
  });
});

describe('parseStoredWorkflow', () => {
  it('reads JSON text and objects, keeps null, and throws on anything invalid (fails closed)', () => {
    expect(parseStoredWorkflow(null, 'site')).toBeNull();
    const stored = { stages: [stage], selfApproval: true };
    expect(parseStoredWorkflow(JSON.stringify(stored), 'site')).toEqual(stored);
    expect(parseStoredWorkflow(stored, 'site')).toEqual(stored);
    expect(() => parseStoredWorkflow('{not json', 'site')).toThrow(
      expect.objectContaining({ code: 'APPROVAL_WORKFLOW_CORRUPT' }),
    );
    expect(() => parseStoredWorkflow({ stages: [] }, 'site')).toThrow(
      expect.objectContaining({ code: 'APPROVAL_WORKFLOW_CORRUPT' }),
    );
  });
});

describe('effectiveOf', () => {
  const own = { stages: [stage], selfApproval: false };
  const instance = { stages: [{ ...stage, id: 'default' }], selfApproval: true };

  it('picks the site workflow, the instance default, or none', () => {
    expect(effectiveOf({ mode: 'custom', workflow: own }, instance)).toBe(own);
    expect(effectiveOf({ mode: 'inherit', workflow: own }, instance)).toBe(instance);
    expect(effectiveOf({ mode: 'inherit', workflow: null }, null)).toBeNull();
    expect(effectiveOf({ mode: 'off', workflow: own }, instance)).toBeNull();
  });
});

describe('ineligibleReason', () => {
  it('lets a holder of a named role on this site sign', () => {
    expect(ineligibleReason(input({}))).toBeNull();
  });

  it('counts a role assigned on every site, and a token with the role', () => {
    expect(ineligibleReason(input({ principal: admin('r', [{ roleId: LEGAL, siteId: null }]) }))).toBeNull();
    expect(ineligibleReason(input({ principal: token(LEGAL) }))).toBeNull();
  });

  it('refuses a role held on another site only, or another role', () => {
    expect(ineligibleReason(input({ principal: admin('r', [{ roleId: LEGAL, siteId: 'site-b' }]) }))).toBe(
      'role',
    );
    expect(ineligibleReason(input({ principal: admin('r', [{ roleId: EDITOR, siteId: SITE }]) }))).toBe(
      'role',
    );
    expect(ineligibleReason(input({ principal: token(EDITOR) }))).toBe('role');
  });

  it('lets anyone sign a stage that names no role', () => {
    expect(
      ineligibleReason(input({ stage: { ...stage, roleIds: [] }, principal: admin('r', []) })),
    ).toBeNull();
  });

  it('fails closed when every named role was deleted, and ignores deleted roles among live ones', () => {
    expect(ineligibleReason(input({ knownRoleIds: new Set([EDITOR]) }))).toBe('rolesDeleted');
    expect(
      ineligibleReason(
        input({ stage: { ...stage, roleIds: [LEGAL, EDITOR] }, knownRoleIds: new Set([EDITOR]) }),
      ),
    ).toBe('role');
  });

  it('refuses the creator and the requester unless self-approval is on', () => {
    const author = admin('author', [{ roleId: LEGAL, siteId: SITE }]);
    expect(ineligibleReason(input({ principal: author }))).toBe('self');
    expect(
      ineligibleReason(input({ principal: author, creator: { adminUserId: 'someone', apiTokenId: null } })),
    ).toBe('self');
    expect(ineligibleReason(input({ principal: author, selfApproval: true }))).toBeNull();
    expect(
      ineligibleReason(
        input({
          principal: token(LEGAL),
          creator: { adminUserId: null, apiTokenId: 'token-1' },
          requester: none,
        }),
      ),
    ).toBe('self');
  });

  it('refuses a second approval at the same stage, and approving an outdated review', () => {
    expect(ineligibleReason(input({ signers: [{ adminUserId: 'reviewer', apiTokenId: null }] }))).toBe(
      'signed',
    );
    expect(ineligibleReason(input({ outdated: true }))).toBe('outdated');
  });

  it('still lets a signer or anyone eligible request changes on an outdated review', () => {
    expect(
      ineligibleReason(
        input({
          decision: 'request_changes',
          outdated: true,
          signers: [{ adminUserId: 'reviewer', apiTokenId: null }],
        }),
      ),
    ).toBeNull();
    expect(ineligibleReason(input({ decision: 'request_changes', principal: token(EDITOR) }))).toBe('role');
  });
});

describe('nextReviewStep', () => {
  it('waits for the required sign-offs, then moves on, and approves after the last stage', () => {
    expect(nextReviewStep({ stageIndex: 1, stageCount: 2, signed: 1, required: 2 })).toEqual({
      kind: 'waiting',
    });
    expect(nextReviewStep({ stageIndex: 0, stageCount: 2, signed: 1, required: 1 })).toEqual({
      kind: 'nextStage',
      stageIndex: 1,
    });
    expect(nextReviewStep({ stageIndex: 1, stageCount: 2, signed: 2, required: 2 })).toEqual({
      kind: 'approved',
    });
  });
});

describe('isReviewOutdated', () => {
  const row = (status: string, fingerprint: string | null) => ({
    id: 'set',
    status: 'open',
    shipped_seq: null,
    approval_status: status,
    approval_fingerprint: fingerprint,
  });

  it('is outdated when a pinned review (in review with a sign-off, or approved) no longer matches', () => {
    expect(isReviewOutdated(row('requested', 'a'), 'b')).toBe(true);
    expect(isReviewOutdated(row('approved', 'a'), 'b')).toBe(true);
    expect(isReviewOutdated(row('requested', 'a'), 'a')).toBe(false);
  });

  it('is never outdated before the first sign-off, or once sent back or cleared', () => {
    expect(isReviewOutdated(row('requested', null), 'b')).toBe(false);
    expect(isReviewOutdated(row('changes_requested', 'a'), 'b')).toBe(false);
    expect(isReviewOutdated(row('none', 'a'), 'b')).toBe(false);
  });
});
