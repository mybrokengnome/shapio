import { routeKeyOf } from '@shapio/schema';
import {
  PREVIEW_TOKEN_DEFAULT_TTL_SECONDS,
  PREVIEW_TOKEN_MAX_TTL_SECONDS,
  PREVIEW_TOKEN_PREFIX,
} from '../constants/publishing.js';
import { writeLocaleFor } from '../content/locales.js';
import { resolveModel } from '../content/model.js';
import { AppError } from '../helpers/appError.js';
import { generateToken, hashToken, safeEqual } from '../helpers/tokens.js';
import { renderPreviewUrl } from '../publishing/previewUrl.js';
import { adminIdOf } from '../publishing/principals.js';
import type { PublishingRuntime } from '../publishing/runtime.js';
import { modelKeyOf } from '../publishing/targets.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';
import * as entriesRepository from '../repositories/entries.js';
import * as previewTokensRepository from '../repositories/previewTokens.js';
import type { PreviewTokenSummary } from '../repositories/previewTokens.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { recordAudit } from './audit.js';
import { assertEntryVisible, modelWithPolicy, type ContentServiceContext } from './contentAccess.js';

/**
 * Preview tokens (brief §7): scoped to one model, or one entry (and locale), expiring, revocable, signed with
 * a key derived from the instance signing secret and stored only as a hash. They read DRAFT content through
 * `/api/preview/content` with the creator's current permissions (services/previewContent.ts). They are the
 * only credential that ever appears in a preview URL; admin credentials never do.
 */
export type PreviewTokenView = {
  id: string;
  tokenPrefix: string;
  modelId: string;
  modelKey: string | null;
  entryId: string | null;
  locale: string | null;
  connectionId: string | null;
  /** Fields follow this delivery role's grants (within the creator's access); null = public fields. */
  deliveryRoleId: string | null;
  createdBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

const PREFIX_DISPLAY_LENGTH = 12;

export const toPreviewTokenView = (snapshot: SchemaSnapshot, row: PreviewTokenSummary): PreviewTokenView => ({
  id: row.id,
  tokenPrefix: row.token_prefix,
  modelId: row.model_id,
  modelKey: modelKeyOf(snapshot, row.model_id),
  entryId: row.entry_id,
  locale: row.locale,
  connectionId: row.connection_id,
  deliveryRoleId: row.delivery_role_id,
  createdBy: row.created_by,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  lastUsedAt: row.last_used_at,
  createdAt: row.created_at,
});

export const isPreviewTokenFormat = (value: string) => value.startsWith(PREVIEW_TOKEN_PREFIX);

/** `shpv_<random>.<mac>`: the MAC lets forged or foreign tokens be rejected without a database lookup. */
const mintToken = (runtime: PublishingRuntime) => {
  const random = generateToken();
  return `${PREVIEW_TOKEN_PREFIX}${random}.${runtime.secrets.mac(random)}`;
};

const hasValidMac = (runtime: PublishingRuntime, token: string) => {
  const [random, mac] = token.slice(PREVIEW_TOKEN_PREFIX.length).split('.');
  return Boolean(random && mac) && safeEqual(runtime.secrets.mac(random as string), mac as string);
};

/** The live token row for a presented token, or undefined (unknown, forged, expired or revoked). */
export const resolvePreviewToken = async (runtime: PublishingRuntime, token: string) => {
  if (!isPreviewTokenFormat(token) || !hasValidMac(runtime, token)) {
    return undefined;
  }
  const now = runtime.now();
  const row = await previewTokensRepository.findLiveByHash(hashToken(token), now, runtime.db);
  if (row) {
    await previewTokensRepository.touchLastUsed(row.id, now, new Date(now.getTime() - 60_000), runtime.db);
  }
  return row;
};

export type CreatePreviewTokenInput = {
  modelKey: string;
  entryId?: string | undefined;
  locale?: string | undefined;
  ttlSeconds?: number | undefined;
  connectionId?: string | undefined;
  deliveryRoleId?: string | undefined;
};

const findPreviewConnection = async (runtime: PublishingRuntime, connectionId: string | undefined) => {
  if (!connectionId) {
    return deploymentConnectionsRepository.findFirstWithPreview(runtime.db);
  }
  const connection = await deploymentConnectionsRepository.findById(connectionId, runtime.db);
  if (!connection) {
    throw new AppError(404, 'CONNECTION_NOT_FOUND', `No deployment connection ${connectionId}`);
  }
  return connection;
};

/** Creates a token for content the caller may read; returns it once, with the rendered preview URL. */
export const createPreviewToken = async (
  context: ContentServiceContext,
  runtime: PublishingRuntime,
  input: CreatePreviewTokenInput,
) => {
  const { model, policy } = await modelWithPolicy(context, input.modelKey, 'read');
  if (input.entryId) {
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.findLive(input.entryId, model.definition.id, context.db),
      input.entryId,
    );
  }
  const createdBy = adminIdOf(context.actor);
  if (!createdBy) {
    throw new AppError(403, 'FORBIDDEN', 'Preview tokens are created by signed-in admins');
  }
  const ttl = Math.min(
    PREVIEW_TOKEN_MAX_TTL_SECONDS,
    Math.max(60, input.ttlSeconds ?? PREVIEW_TOKEN_DEFAULT_TTL_SECONDS),
  );
  const locale =
    model.definition.localized && input.locale !== undefined
      ? writeLocaleFor(context.snapshot, model.definition, input.locale)
      : null;
  const connection = await findPreviewConnection(runtime, input.connectionId);
  // Bound to a delivery role: explicitly, or by the connection whose preview URL the token is for.
  const deliveryRoleId = input.deliveryRoleId ?? connection?.delivery_role_id ?? null;
  if (deliveryRoleId) {
    const role = await adminRolesRepository.findById(deliveryRoleId, context.db);
    if (!role || role.kind !== 'delivery') {
      throw new AppError(400, 'INVALID_ROLE', 'Preview tokens can only follow a delivery role');
    }
  }
  const token = mintToken(runtime);
  const now = runtime.now();
  const row = await context.db.transaction().execute(async (trx) => {
    const inserted = await previewTokensRepository.insert(
      {
        token_hash: hashToken(token),
        token_prefix: token.slice(0, PREFIX_DISPLAY_LENGTH),
        model_id: model.definition.id,
        entry_id: input.entryId ?? null,
        locale,
        connection_id: connection?.id ?? null,
        delivery_role_id: deliveryRoleId,
        created_by: createdBy,
        expires_at: new Date(now.getTime() + ttl * 1000),
      },
      trx,
    );
    await recordAudit(trx, {
      actor: context.actor,
      action: 'preview_token.create',
      target: { type: 'preview_token', id: inserted.id },
      metadata: { modelKey: input.modelKey, entryId: input.entryId ?? null, locale, ttlSeconds: ttl },
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
    });
    return inserted;
  });
  const url =
    connection?.preview_url_template && input.entryId
      ? renderPreviewUrl(connection.preview_url_template, {
          token,
          modelKey: routeKeyOf(model.definition),
          entryId: input.entryId,
          locale: locale ?? context.snapshot.defaultLocale,
        })
      : null;
  return { token, previewToken: toPreviewTokenView(context.snapshot, row), url };
};

/** The entry form's Preview action: a one-hour token for this entry and locale, and where to open it. */
export const openPreview = async (
  context: ContentServiceContext,
  runtime: PublishingRuntime,
  input: {
    modelKey: string;
    entryId: string;
    locale?: string | undefined;
    connectionId?: string | undefined;
  },
) => {
  const created = await createPreviewToken(context, runtime, input);
  const locale = created.previewToken.locale;
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  // The preview route, like delivery, is addressed by the route key (plural API ID of a collection).
  const routeKey = routeKeyOf(resolveModel(context.snapshot, input.modelKey).definition);
  return {
    url: created.url,
    apiUrl: runtime.urls.absoluteUrl(
      `/api/preview/content/${encodeURIComponent(routeKey)}/${encodeURIComponent(input.entryId)}${query}`,
    ),
    token: created.token,
    expiresAt: created.previewToken.expiresAt,
    connectionId: created.previewToken.connectionId,
  };
};

export const listPreviewTokens = async (
  context: ContentServiceContext,
  filter: { entryId?: string | undefined },
) =>
  (await previewTokensRepository.list(filter.entryId ? { entryId: filter.entryId } : {}, context.db)).map(
    (row) => toPreviewTokenView(context.snapshot, row),
  );

/** Revokes a token. Its creator may revoke it; so may anyone allowed to manage tokens. */
export const revokePreviewToken = async (
  context: ContentServiceContext,
  id: string,
  { canManageAll }: { canManageAll: boolean },
) => {
  const row = await previewTokensRepository.findById(id, context.db);
  if (!row || (!canManageAll && row.created_by !== adminIdOf(context.actor))) {
    throw new AppError(404, 'PREVIEW_TOKEN_NOT_FOUND', `No preview token ${id}`);
  }
  await context.db.transaction().execute(async (trx) => {
    await previewTokensRepository.revoke(id, new Date(), trx);
    await recordAudit(trx, {
      actor: context.actor,
      action: 'preview_token.revoke',
      target: { type: 'preview_token', id },
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
    });
  });
};
