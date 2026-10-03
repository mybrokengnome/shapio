import {
  MysqlQueryCompiler,
  ValuesNode,
  type CompiledQuery,
  type InsertQueryNode,
  type OnConflictNode,
  type OnDuplicateKeyNode,
  type QueryId,
  type ReturningNode,
  type RootOperationNode,
} from 'kysely';
import { EXCLUDED_ALIAS } from './conflicts.js';
import { planFor, plannedStatement, type StatementPlan } from './plans.js';

/** The property of a compiled query that carries its plan (`plans.ts`). */
export const STATEMENT_PLAN = Symbol('shapio.mysql.plan');

export type PlannedQuery = CompiledQuery & { readonly [STATEMENT_PLAN]?: StatementPlan };

export const planOf = (query: CompiledQuery): StatementPlan | undefined =>
  (query as PlannedQuery)[STATEMENT_PLAN];

/**
 * Kysely's MySQL compiler, plus: statements MySQL cannot run as one get a plan (`plans.ts`), and
 * `ON DUPLICATE KEY UPDATE` names the inserted row `excluded` (MySQL ≥ 8.0.19 row alias), so the
 * `excluded.<column>` references of a PostgreSQL upsert compile unchanged.
 */
export class ShapioMysqlQueryCompiler extends MysqlQueryCompiler {
  #insertWithValues = false;

  override compileQuery(node: RootOperationNode, queryId: QueryId): CompiledQuery {
    const plan = planFor(node, (statement) =>
      new ShapioMysqlQueryCompiler().compileQuery(statement, queryId),
    );
    if (!plan) {
      return super.compileQuery(node, queryId);
    }
    const shown = super.compileQuery(plannedStatement(node), queryId);
    // `query` stays the full statement: Kysely reads its RETURNING to decide what `execute` returns.
    return Object.freeze({ ...shown, query: node, [STATEMENT_PLAN]: plan });
  }

  protected override visitInsertQuery(node: InsertQueryNode): void {
    const previous = this.#insertWithValues;
    this.#insertWithValues = node.values !== undefined && ValuesNode.is(node.values);
    try {
      super.visitInsertQuery(node);
    } finally {
      this.#insertWithValues = previous;
    }
  }

  protected override visitOnDuplicateKey(node: OnDuplicateKeyNode): void {
    if (this.#insertWithValues) {
      this.append(
        `as ${this.getLeftIdentifierWrapper()}${EXCLUDED_ALIAS}${this.getRightIdentifierWrapper()} `,
      );
    }
    super.visitOnDuplicateKey(node);
  }

  protected override visitOnConflict(_node: OnConflictNode): void {
    throw new Error('MySQL has no ON CONFLICT; the MySQL plugin or a statement plan must replace it');
  }

  protected override visitReturning(_node: ReturningNode): void {
    throw new Error('MySQL has no RETURNING; a statement plan must replace it');
  }
}
