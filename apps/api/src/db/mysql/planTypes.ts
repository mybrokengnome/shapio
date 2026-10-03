import type { CompiledQuery, QueryResult, RootOperationNode, UnknownRow } from 'kysely';

/** What a statement plan runs on (the MySQL connection, `driver.ts`). See `plans.ts`. */
export type PlanContext = {
  run: (query: CompiledQuery) => Promise<QueryResult<UnknownRow>>;
  /** Runs `fn` so it commits or rolls back as one statement would. */
  atomically: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Runs `fn` under a savepoint: rolled back alone when it throws (inside `atomically`). */
  savepoint: <T>(fn: () => Promise<T>) => Promise<T>;
};

export type StatementPlan = (context: PlanContext) => Promise<QueryResult<UnknownRow>>;

export type Compile = (node: RootOperationNode) => CompiledQuery;
