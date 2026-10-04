import { sql, type Kysely } from 'kysely';

/**
 * MySQL twin of `../20261004120000_models_site_scope.ts`. The per-scope API ID key uses functional key parts,
 * like the baseline: `coalesce(site_id, '')` for the scope (MySQL has no `NULLS NOT DISTINCT`) and the
 * case-folded API ID of live rows only (a deleted row's part is NULL, and NULLs never collide).
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`models\` add column \`site_id\` char(36) character set ascii collate ascii_general_ci`.execute(
    db,
  );
  await sql`create index \`models_site_idx\` on \`models\` (\`site_id\`)`.execute(db);
  await sql`alter table \`models\` add constraint \`models_site_id_fkey\` foreign key (\`site_id\`) references \`sites\` (\`id\`)`.execute(
    db,
  );
  await sql`drop index \`models_api_key_uq\` on \`models\``.execute(db);
  await sql`create unique index \`models_api_key_uq\` on \`models\`
    ((coalesce(\`site_id\`, '')), (case when (\`deleted_at\` IS NULL) then lower(\`api_key\`) end))`.execute(
    db,
  );
  await sql`alter table \`schema_drafts\` add column \`shared\` tinyint(1) not null default 0`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  const { rows } = await sql<{
    count: number;
  }>`select count(*) as count from \`models\` where \`site_id\` is not null`.execute(db);
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new Error(
      'Cannot roll back per-site schema while definitions belong to a site: two sites may share an API ID. ' +
        'Share or delete the site definitions first.',
    );
  }
  await sql`alter table \`schema_drafts\` drop column \`shared\``.execute(db);
  await sql`drop index \`models_api_key_uq\` on \`models\``.execute(db);
  await sql`create unique index \`models_api_key_uq\` on \`models\`
    ((case when (\`deleted_at\` IS NULL) then lower(\`api_key\`) end))`.execute(db);
  await sql`alter table \`models\` drop foreign key \`models_site_id_fkey\``.execute(db);
  await sql`drop index \`models_site_idx\` on \`models\``.execute(db);
  await sql`alter table \`models\` drop column \`site_id\``.execute(db);
};
