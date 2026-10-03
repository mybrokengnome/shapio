import type { RootOperationNode } from 'kysely';
import { insertPlan } from './insertPlan.js';
import { deletePlan, updatePlan } from './keyedWritePlans.js';
import type { Compile, StatementPlan } from './planTypes.js';

export type { Compile, PlanContext, StatementPlan } from './planTypes.js';

/**
 * Statement plans (ADR 0001, "MySQL"): MySQL has no `RETURNING` and no `ON CONFLICT (target) DO NOTHING`,
 * so the compiler turns such a statement into a few statements the connection runs atomically (inside the
 * caller's transaction under a savepoint, or in a transaction of its own):
 * - INSERT … RETURNING: the insert, then a SELECT of the returned columns by primary key (keys are known:
 *   the plugin generates UUIDs; an identity key comes from `LAST_INSERT_ID()`, one row per statement).
 * - INSERT … ON CONFLICT (target) DO NOTHING [RETURNING]: each row inserted under a savepoint; a duplicate
 *   on the target's unique index (any index without a target) rolls that row back and returns nothing for
 *   it, so other unique violations still raise, as on PostgreSQL.
 * - UPDATE/DELETE … RETURNING: `SELECT <key> … FOR UPDATE` with the statement's WHERE (or, for
 *   `key IN (subquery)`, the subquery itself, keeping its `FOR UPDATE SKIP LOCKED`), the statement by key,
 *   then (UPDATE) a SELECT of the returned columns by key. The rows stay locked, so the result is exact.
 */
/** The plan a statement needs on MySQL, or undefined when it runs as written. */
export const planFor = (node: RootOperationNode, compile: Compile): StatementPlan | undefined => {
  switch (node.kind) {
    case 'InsertQueryNode':
      return node.returning || node.onConflict ? insertPlan(node, compile) : undefined;
    case 'UpdateQueryNode':
      return node.returning ? updatePlan(node, compile) : undefined;
    case 'DeleteQueryNode':
      return node.returning ? deletePlan(node, compile) : undefined;
    default:
      return undefined;
  }
};

/** The statement without the parts a plan replaces (what logs and errors show). */
export const plannedStatement = (node: RootOperationNode): RootOperationNode =>
  node.kind === 'InsertQueryNode' || node.kind === 'UpdateQueryNode' || node.kind === 'DeleteQueryNode'
    ? Object.freeze({
        ...node,
        returning: undefined,
        ...(node.kind === 'InsertQueryNode' ? { onConflict: undefined } : {}),
      })
    : node;
