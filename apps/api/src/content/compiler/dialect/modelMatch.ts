import { sql, type RawBuilder } from 'kysely';

/**
 * `column` names one of the models: `= <literal>` for one model (the form partial indexes match), `in (…)`
 * for a family (plan polymorphic-types). Model IDs arrive as literals already checked by `expressions.ts`.
 */
export const modelIdMatches = (
  column: RawBuilder<unknown>,
  modelIds: readonly RawBuilder<unknown>[],
): RawBuilder<unknown> =>
  modelIds.length === 1 ? sql`${column} = ${modelIds[0]}` : sql`${column} in (${sql.join([...modelIds])})`;
