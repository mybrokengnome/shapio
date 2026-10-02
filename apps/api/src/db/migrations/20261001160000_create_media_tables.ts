import { sql, type CreateTableBuilder, type Kysely } from 'kysely';

/**
 * Media library (package G): folders, assets, image variants, references from content and upload grants.
 * Bytes live in a storage driver (local disk or S3-compatible); rows record which driver and key hold
 * each object, so `shapio media migrate` can move assets one at a time while the server keeps serving.
 */

const withTimestamps = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`));

const uuidPrimaryKey = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`));

const STORAGE_DRIVER_CHECK = sql`storage_driver in ('local', 's3')`;
const VISIBILITY_CHECK = sql`visibility in ('public', 'private')`;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('media_folders'))
      // Restrict: a folder with subfolders cannot be deleted (the service reports a conflict first).
      .addColumn('parent_id', 'uuid', (col) => col.references('media_folders.id').onDelete('restrict'))
      .addColumn('name', 'text', (col) => col.notNull().check(sql`length(name) between 1 and 255`))
      .addColumn('created_by', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'))
      .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1)),
  ).execute();
  // Sibling names are unique, case-insensitively; root folders (parent_id null) are siblings too.
  await sql`create unique index media_folders_sibling_name_uq on media_folders
    (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))`.execute(db);

  // `id` is assigned when the upload grant is issued, so the storage key can contain it before the row exists.
  // `status`: `processing` until the checksum, dimensions and variants job has run.
  await withTimestamps(
    db.schema
      .createTable('media_assets')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('folder_id', 'uuid', (col) => col.references('media_folders.id').onDelete('set null'))
      .addColumn('storage_driver', 'text', (col) => col.notNull().check(STORAGE_DRIVER_CHECK))
      .addColumn('storage_key', 'text', (col) => col.notNull())
      .addColumn('original_filename', 'text', (col) => col.notNull())
      .addColumn('mime_type', 'text', (col) => col.notNull())
      .addColumn('size_bytes', 'bigint', (col) => col.notNull())
      .addColumn('width', 'integer')
      .addColumn('height', 'integer')
      .addColumn('checksum_sha256', 'text')
      .addColumn('alt', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('caption', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('focal_x', 'real', (col) => col.check(sql`focal_x between 0 and 1`))
      .addColumn('focal_y', 'real', (col) => col.check(sql`focal_y between 0 and 1`))
      .addColumn('visibility', 'text', (col) => col.notNull().defaultTo('public').check(VISIBILITY_CHECK))
      .addColumn('status', 'text', (col) =>
        col
          .notNull()
          .defaultTo('processing')
          .check(sql`status in ('processing', 'ready', 'failed')`),
      )
      .addColumn('processing_error', 'text')
      .addColumn('created_by', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'))
      .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
      .addColumn('deleted_at', 'timestamptz')
      .addCheckConstraint('media_assets_focal_point_ck', sql`(focal_x is null) = (focal_y is null)`),
  ).execute();
  await db.schema
    .createIndex('media_assets_storage_key_uq')
    .on('media_assets')
    .column('storage_key')
    .unique()
    .execute();
  await db.schema
    .createIndex('media_assets_folder_idx')
    .on('media_assets')
    .columns(['folder_id', 'created_at', 'id'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();
  await db.schema
    .createIndex('media_assets_created_idx')
    .on('media_assets')
    .columns(['created_at', 'id'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();
  // `shapio media migrate` walks assets by driver.
  await db.schema
    .createIndex('media_assets_driver_idx')
    .on('media_assets')
    .columns(['storage_driver', 'id'])
    .execute();

  // Variants live on the same driver as their asset and move with it.
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('media_variants'))
      .addColumn('asset_id', 'uuid', (col) => col.notNull().references('media_assets.id').onDelete('cascade'))
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('width', 'integer')
      .addColumn('height', 'integer')
      .addColumn('format', 'text', (col) => col.notNull())
      .addColumn('mime_type', 'text', (col) => col.notNull())
      .addColumn('storage_key', 'text')
      .addColumn('size_bytes', 'bigint')
      .addColumn('checksum_sha256', 'text')
      .addColumn('status', 'text', (col) =>
        col
          .notNull()
          .defaultTo('pending')
          .check(sql`status in ('pending', 'ready', 'failed')`),
      )
      .addColumn('error', 'text')
      .addUniqueConstraint('media_variants_asset_name_uq', ['asset_id', 'name']),
  ).execute();
  await db.schema
    .createIndex('media_variants_storage_key_uq')
    .on('media_variants')
    .column('storage_key')
    .unique()
    .execute();

  // Which entry heads use an asset ("used in", delete protection). Written by content saves (package E) in
  // the head-moving transaction; `model_id` is denormalised for display.
  await db.schema
    .createTable('media_references')
    .addColumn('asset_id', 'uuid', (col) => col.notNull().references('media_assets.id').onDelete('cascade'))
    .addColumn('entry_id', 'uuid', (col) => col.notNull().references('entries.id').onDelete('cascade'))
    .addColumn('model_id', 'uuid', (col) => col.notNull())
    .addColumn('field_id', 'text', (col) => col.notNull())
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull().check(sql`state in ('draft', 'published')`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('media_references_pk', ['asset_id', 'entry_id', 'locale', 'state', 'field_id'])
    .execute();
  await db.schema
    .createIndex('media_references_entry_idx')
    .on('media_references')
    .columns(['entry_id', 'locale', 'state'])
    .execute();

  // One upload: the asset ID and storage key are fixed when the grant is issued; size and type are limits
  // the storage (presigned POST policy) or the upload route enforces, and confirm re-checks from the bytes.
  await db.schema
    .createTable('media_upload_grants')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('asset_id', 'uuid', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull().check(sql`kind in ('create', 'replace')`))
    .addColumn('storage_driver', 'text', (col) => col.notNull().check(STORAGE_DRIVER_CHECK))
    .addColumn('storage_key', 'text', (col) => col.notNull().unique())
    .addColumn('original_filename', 'text', (col) => col.notNull())
    .addColumn('declared_mime_type', 'text', (col) => col.notNull())
    .addColumn('max_size_bytes', 'bigint', (col) => col.notNull())
    .addColumn('folder_id', 'uuid')
    .addColumn('visibility', 'text', (col) => col.notNull().check(VISIBILITY_CHECK))
    .addColumn('created_by', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'))
    // Who may confirm: the principal that asked for the grant (`admin:<id>` or `token:<id>`).
    .addColumn('created_by_principal', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'consumed', 'rejected', 'expired')`),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('media_upload_grants').execute();
  await db.schema.dropTable('media_references').execute();
  await db.schema.dropTable('media_variants').execute();
  await db.schema.dropTable('media_assets').execute();
  await db.schema.dropTable('media_folders').execute();
};
