import { sql, type Kysely } from 'kysely';

/**
 * Sites, publishing (plan agentic-ecosystem §H, package G5).
 *
 * - `change_set_items.site_id`: a copy of the set's site, tied to the set and to the item's entry by
 *   composite foreign keys, so a change set can never hold another site's entry (schema items have no entry;
 *   their entry key is null and the entry foreign key does not apply).
 * - `preview_tokens.entry_id` becomes required: a preview token previews one entry of one site. Model-wide
 *   tokens (short-lived by design) are deleted; whoever needs one opens the entry's preview again.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table change_sets add constraint change_sets_id_site_uq unique (id, site_id)`.execute(db);
  await sql`alter table change_set_items add column site_id uuid`.execute(db);
  await sql`
    update change_set_items i set site_id = s.site_id from change_sets s where s.id = i.change_set_id
  `.execute(db);
  await sql`alter table change_set_items alter column site_id set not null`.execute(db);
  await sql`alter table change_set_items add constraint change_set_items_set_site_fk
    foreign key (change_set_id, site_id) references change_sets(id, site_id) on delete cascade not valid`.execute(
    db,
  );
  await sql`alter table change_set_items validate constraint change_set_items_set_site_fk`.execute(db);
  await sql`alter table change_set_items add constraint change_set_items_entry_site_fk
    foreign key (entry_id, site_id) references entries(id, site_id) on delete cascade not valid`.execute(db);
  await sql`alter table change_set_items validate constraint change_set_items_entry_site_fk`.execute(db);

  await sql`delete from preview_tokens where entry_id is null`.execute(db);
  await sql`alter table preview_tokens alter column entry_id set not null`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table preview_tokens alter column entry_id drop not null`.execute(db);
  await sql`alter table change_set_items drop constraint change_set_items_entry_site_fk`.execute(db);
  await sql`alter table change_set_items drop constraint change_set_items_set_site_fk`.execute(db);
  await sql`alter table change_set_items drop column site_id`.execute(db);
  await sql`alter table change_sets drop constraint change_sets_id_site_uq`.execute(db);
};
