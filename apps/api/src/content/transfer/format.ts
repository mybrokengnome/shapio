import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { AppError } from '../../helpers/appError.js';

/**
 * The content export bundle (package L): newline-delimited JSON, one record per line, in this order:
 * header, locales, schema lock, definitions, app roles, delivery roles, app users (opt-in), webhooks, deployment
 * connections, media folders, media assets (the media manifest: key, size, SHA-256 per file), entries,
 * end. Values are as stored: content keyed by stable field IDs, IDs preserved, so an import into a fresh
 * database reproduces the same delivery responses. Secrets never appear: webhook and connection secrets
 * are left out, app-user passwords only as their argon2 hashes and only with `includeUsers`.
 *
 * Every record is validated on import (the bundle is untrusted input); unknown record types are rejected.
 */
export const BUNDLE_FORMAT = 'shapio-export';
export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_CONTENT_TYPE = 'application/x-ndjson';

const Uuid = Type.String({ format: 'uuid' });
const NullableUuid = Type.Union([Uuid, Type.Null()]);
const DateTime = Type.String({ minLength: 1, maxLength: 64 });
const NullableDateTime = Type.Union([DateTime, Type.Null()]);
const JsonObject = Type.Record(Type.String(), Type.Unknown());

export const ExportOptionsSchema = Type.Object(
  { headsOnly: Type.Boolean(), includeUsers: Type.Boolean() },
  { additionalProperties: false },
);
export type ExportOptions = Static<typeof ExportOptionsSchema>;

const HeaderSchema = Type.Object(
  {
    type: Type.Literal('header'),
    format: Type.Literal(BUNDLE_FORMAT),
    formatVersion: Type.Literal(BUNDLE_FORMAT_VERSION),
    shapioVersion: Type.String(),
    exportedAt: DateTime,
    schemaVersion: Type.Integer({ minimum: 0 }),
    /** The publication sequence the bundle reflects (delivery's `?snapshot=`). */
    snapshot: Type.Integer({ minimum: 0 }),
    options: ExportOptionsSchema,
  },
  { additionalProperties: false },
);

const LocaleSchema = Type.Object(
  {
    type: Type.Literal('locale'),
    code: Type.String({ minLength: 1, maxLength: 35 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    isDefault: Type.Boolean(),
    fallbacks: Type.Array(Type.String({ minLength: 1, maxLength: 35 })),
  },
  { additionalProperties: false },
);

const SchemaLockSchema = Type.Object(
  { type: Type.Literal('schemaLock'), lock: JsonObject },
  { additionalProperties: false },
);

const DefinitionSchema = Type.Object(
  {
    type: Type.Literal('definition'),
    definition: JsonObject,
    version: Type.Integer({ minimum: 1 }),
    hash: Type.String(),
    /**
     * `site`: the exported site's own definition, imported onto the target site. `network` (or absent, in
     * bundles from before per-site schemas): shared with all sites on the target too.
     */
    scope: Type.Optional(Type.Union([Type.Literal('network'), Type.Literal('site')])),
  },
  { additionalProperties: false },
);

const PermissionSchema = Type.Object(
  {
    action: Type.String({ minLength: 1, maxLength: 64 }),
    modelId: NullableUuid,
    condition: Type.Union([Type.Literal('ownedByPrincipal'), Type.Null()]),
    fieldIds: Type.Union([Type.Array(Uuid), Type.Null()]),
  },
  { additionalProperties: false },
);

const AppRoleSchema = Type.Object(
  {
    type: Type.Literal('appRole'),
    id: Uuid,
    key: Type.String({ minLength: 1, maxLength: 100 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.String({ maxLength: 2000 }),
    isSystem: Type.Boolean(),
    permissions: Type.Array(PermissionSchema),
  },
  { additionalProperties: false },
);

/** Custom delivery roles (what delivery tokens hold). Their tokens are never exported. */
const DeliveryRoleSchema = Type.Object(
  {
    type: Type.Literal('deliveryRole'),
    id: Uuid,
    key: Type.String({ minLength: 1, maxLength: 100 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.String({ maxLength: 2000 }),
    permissions: Type.Array(PermissionSchema),
  },
  { additionalProperties: false },
);

const AppUserSchema = Type.Object(
  {
    type: Type.Literal('appUser'),
    id: Uuid,
    email: Type.String({ minLength: 3, maxLength: 320 }),
    name: Type.String({ maxLength: 200 }),
    /** The argon2id hash, never a plain password; null for OAuth-only accounts. */
    passwordHash: Type.Union([Type.String({ pattern: '^\\$argon2' }), Type.Null()]),
    confirmedAt: NullableDateTime,
    blockedAt: NullableDateTime,
    passwordChangedAt: NullableDateTime,
    createdAt: DateTime,
    updatedAt: DateTime,
    roleKeys: Type.Array(Type.String({ minLength: 1, maxLength: 100 })),
    oauthAccounts: Type.Array(
      Type.Object(
        {
          provider: Type.String({ minLength: 1, maxLength: 50 }),
          providerUserId: Type.String({ minLength: 1, maxLength: 200 }),
          email: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const WebhookSchema = Type.Object(
  {
    type: Type.Literal('webhook'),
    id: Uuid,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    url: Type.String({ pattern: '^https?://' }),
    events: Type.Array(Type.String({ minLength: 1, maxLength: 100 })),
    enabled: Type.Boolean(),
    allowPrivateNetwork: Type.Boolean(),
    maxAttempts: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
);

const ConnectionSchema = Type.Object(
  {
    type: Type.Literal('deploymentConnection'),
    id: Uuid,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    provider: Type.String({ minLength: 1, maxLength: 50 }),
    settings: Type.Record(Type.String(), Type.String()),
    /** Secret name → environment variable name (`${ENV:NAME}` references). Literal secrets are never exported. */
    secretEnvRefs: Type.Record(Type.String(), Type.String()),
    previewUrlTemplate: Type.Union([Type.String(), Type.Null()]),
    triggerPolicy: Type.Array(Type.String()),
    debounceSeconds: Type.Integer({ minimum: 0 }),
    allowPrivateNetwork: Type.Boolean(),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

const MediaFolderSchema = Type.Object(
  {
    type: Type.Literal('mediaFolder'),
    id: Uuid,
    parentId: NullableUuid,
    name: Type.String({ minLength: 1, maxLength: 255 }),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false },
);

const MediaAssetSchema = Type.Object(
  {
    type: Type.Literal('mediaAsset'),
    id: Uuid,
    folderId: NullableUuid,
    filename: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.String({ minLength: 3, maxLength: 255 }),
    sizeBytes: Type.Integer({ minimum: 0 }),
    width: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    height: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    /** The file's SHA-256 (hex): what an import verifies the file against. Null while still processing. */
    sha256: Type.Union([Type.String({ pattern: '^[0-9a-f]{64}$' }), Type.Null()]),
    alt: Type.String(),
    caption: Type.String(),
    focalX: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
    focalY: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
    visibility: Type.Union([Type.Literal('public'), Type.Literal('private')]),
    storageKey: Type.String({ minLength: 1, maxLength: 1024 }),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false },
);

const RevisionSchema = Type.Object(
  {
    id: Uuid,
    locale: Type.String({ minLength: 1, maxLength: 35 }),
    parentRevisionId: NullableUuid,
    reason: Type.Enum(['create', 'save', 'publish', 'restore', 'duplicate', 'localize']),
    data: JsonObject,
    createdAt: DateTime,
  },
  { additionalProperties: false },
);

const HeadSchema = Type.Object(
  {
    locale: Type.String({ minLength: 1, maxLength: 35 }),
    state: Type.Union([Type.Literal('draft'), Type.Literal('published')]),
    revisionId: Uuid,
    data: JsonObject,
    autosavedAt: NullableDateTime,
    version: Type.Integer({ minimum: 1 }),
    createdAt: DateTime,
    updatedAt: DateTime,
    /** Published heads: when the live version was published (the snapshot's `publishedAt`). */
    publishedAt: NullableDateTime,
  },
  { additionalProperties: false },
);

const EntrySchema = Type.Object(
  {
    type: Type.Literal('entry'),
    id: Uuid,
    modelId: Uuid,
    ownerAppUserId: NullableUuid,
    createdAt: DateTime,
    updatedAt: DateTime,
    /** Parents before children. Heads-only bundles carry just the revisions heads point at. */
    revisions: Type.Array(RevisionSchema),
    heads: Type.Array(HeadSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

const EndSchema = Type.Object(
  { type: Type.Literal('end'), counts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })) },
  { additionalProperties: false },
);

export type HeaderRecord = Static<typeof HeaderSchema>;
export type LocaleRecord = Static<typeof LocaleSchema>;
export type SchemaLockRecord = Static<typeof SchemaLockSchema>;
export type DefinitionRecord = Static<typeof DefinitionSchema>;
export type AppRoleRecord = Static<typeof AppRoleSchema>;
export type DeliveryRoleRecord = Static<typeof DeliveryRoleSchema>;
export type AppUserRecord = Static<typeof AppUserSchema>;
export type WebhookRecord = Static<typeof WebhookSchema>;
export type ConnectionRecord = Static<typeof ConnectionSchema>;
export type MediaFolderRecord = Static<typeof MediaFolderSchema>;
export type MediaAssetRecord = Static<typeof MediaAssetSchema>;
export type RevisionRecord = Static<typeof RevisionSchema>;
export type HeadRecordInBundle = Static<typeof HeadSchema>;
export type EntryRecord = Static<typeof EntrySchema>;
export type EndRecord = Static<typeof EndSchema>;

export type BundleRecord =
  | HeaderRecord
  | LocaleRecord
  | SchemaLockRecord
  | DefinitionRecord
  | AppRoleRecord
  | DeliveryRoleRecord
  | AppUserRecord
  | WebhookRecord
  | ConnectionRecord
  | MediaFolderRecord
  | MediaAssetRecord
  | EntryRecord
  | EndRecord;

const SCHEMAS: Readonly<Record<BundleRecord['type'], TSchema>> = {
  header: HeaderSchema,
  locale: LocaleSchema,
  schemaLock: SchemaLockSchema,
  definition: DefinitionSchema,
  appRole: AppRoleSchema,
  deliveryRole: DeliveryRoleSchema,
  appUser: AppUserSchema,
  webhook: WebhookSchema,
  deploymentConnection: ConnectionSchema,
  mediaFolder: MediaFolderSchema,
  mediaAsset: MediaAssetSchema,
  entry: EntrySchema,
  end: EndSchema,
};

/** A bundle that is not valid (400 for the request that sent it). */
export class BundleFormatError extends AppError {
  readonly line: number;

  constructor(line: number, message: string) {
    super(400, 'BUNDLE_INVALID', `Bundle line ${line}: ${message}`, { line });
    this.name = 'BundleFormatError';
    this.line = line;
  }
}

/** Parses and validates one bundle line. */
export const parseRecord = (text: string, line: number): BundleRecord => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BundleFormatError(line, 'not valid JSON');
  }
  const type = (value as { type?: unknown } | null)?.type;
  const schema = typeof type === 'string' ? SCHEMAS[type as BundleRecord['type']] : undefined;
  if (!schema) {
    throw new BundleFormatError(line, `unknown record type ${JSON.stringify(type)}`);
  }
  const [error] = Value.Errors(schema, value);
  if (error) {
    throw new BundleFormatError(line, `${type as string}${error.instancePath} ${error.message}`);
  }
  return value as BundleRecord;
};

export const toLine = (record: BundleRecord): string => `${JSON.stringify(record)}\n`;
