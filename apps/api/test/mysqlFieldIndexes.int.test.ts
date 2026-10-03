import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fieldIndexName } from '../src/content/compiler/expressions.js';
import { getIndexState } from '../src/db/indexCatalog.js';
import { MYSQL_MAX_FIELD_INDEXES } from '../src/db/limits.js';
import { createDefinition, fieldIdOf, runContentSchemaJobs, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { isMysqlRun, withSkipReason } from './helpers/dialect.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * MySQL field indexes (ADR 0001, "MySQL"): each filterable or sortable field is an invisible virtual column
 * and an index on it, built and dropped by the schema jobs; the planner refuses a change that would need more
 * field indexes than InnoDB allows on the content table. Query plans: contentCompilerParity.int.test.ts.
 */
const skipReason = isMysqlRun() ? undefined : 'MySQL field indexes (MySQL runs only)';

describe.skipIf(skipReason)(withSkipReason('MySQL field indexes', skipReason), () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  beforeAll(async () => {
    testApp = await createTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });
  afterAll(async () => {
    await testApp?.app.close();
  });

  const indexColumns = async (indexName: string) => {
    const { rows } = await sql<{ name: string }>`
      select column_name as name from information_schema.statistics
      where table_schema = database() and index_name = ${indexName} order by seq_in_index`.execute(
      database.current.db,
    );
    return rows.map((row) => row.name);
  };

  const columnExtra = async (column: string) => {
    const { rows } = await sql<{ extra: string }>`
      select extra as extra from information_schema.columns
      where table_schema = database() and table_name = 'entry_heads' and column_name = ${column}`.execute(
      database.current.db,
    );
    return rows[0]?.extra;
  };

  // Models are not localized unless they say so: their indexes have no locale column.
  const indexNameOf = (model: ModelBody, apiKey: string, type: 'string' | 'integer') =>
    fieldIndexName({
      modelId: model.definition.id,
      fieldId: fieldIdOf(model, apiKey),
      type,
      localized: false,
    });

  it('builds each field index online on an invisible virtual column, and drops both', async () => {
    const model = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      label: 'Product',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
        { apiKey: 'rank', label: 'Rank', type: 'integer', sortable: true },
      ],
    });
    await runContentSchemaJobs(database.current.db);
    const title = indexNameOf(model, 'title', 'string');
    const column = title.replace(/^eh_/, 'ev_');
    expect(await getIndexState(database.current.db, title)).toBe('valid');
    expect(await indexColumns(title)).toEqual(['site_id', 'model_id', 'state', column]);
    expect(await columnExtra(column)).toMatch(/VIRTUAL GENERATED.*INVISIBLE/i);
    expect(await getIndexState(database.current.db, indexNameOf(model, 'rank', 'integer'))).toBe('valid');

    const updated = await admin.put(`/api/admin/models/${model.definition.id}`, {
      definition: {
        ...model.definition,
        fields: model.definition.fields.map((field) => ({ ...field, filterable: false, sortable: false })),
      },
      expectedVersion: model.version,
    });
    expect(updated.statusCode, updated.body).toBe(200);
    await runContentSchemaJobs(database.current.db);
    expect(await getIndexState(database.current.db, title)).toBe('missing');
    expect(await columnExtra(column)).toBeUndefined();
  });

  it(`refuses a change that needs more than ${MYSQL_MAX_FIELD_INDEXES} field indexes`, async () => {
    const fields = Array.from({ length: MYSQL_MAX_FIELD_INDEXES + 1 }, (_, index) => ({
      apiKey: `f${index}`,
      label: `Field ${index}`,
      type: 'string',
      filterable: true,
    }));
    const refused = await admin.post('/api/admin/models', {
      definition: { kind: 'collection', apiKey: 'wide', label: 'Wide', fields },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('UNSUPPORTED_FLAG');
    expect(refused.body).toContain(`MySQL can index at most ${MYSQL_MAX_FIELD_INDEXES}`);
  });
});
