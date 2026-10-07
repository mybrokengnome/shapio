import { join } from 'node:path';
import type { JsonValue } from '@shapio/schema';
import { htmlToRichText } from '@shapio/schema/html';
import { marked } from 'marked';
import type {
  ImportEntry,
  ImportEntryLocale,
  ImportMedia,
  ImportSource,
  SourceFields,
  SourceValue,
  ValueResolver,
} from '../types.js';
import { blocksToRichText } from './blocks.js';
import type { StrapiEntity, StrapiExport, StrapiId, StrapiLink } from './exportFiles.js';
import { planStrapiSchema, type AttributePlan, type DefinitionPlan } from './schema.js';

/**
 * A Strapi 5 export → the import model. Content types become models (single types singletons), components
 * components, upload files the media library. Each document becomes one entry; its locales come from the
 * document's rows, using the draft row's content. A locale that has a published row in Strapi becomes a
 * publish item of the change set; draft-only locales stay drafts. Relations and media come from the export's
 * links, components and dynamic zones from the rows themselves.
 */
const UPLOAD_FILE = 'plugin::upload.file';

type LinkTarget = { type: string; ref: StrapiId };

type Indexes = {
  plans: Map<string, DefinitionPlan>;
  /** `${type}#${rowId}` → document ID. */
  documents: Map<string, string>;
  /** `${type}#${rowId}#${field}` → targets, in export order. */
  relations: Map<string, LinkTarget[]>;
  /** `${type}#${rowId}#${field}` → upload file IDs. */
  media: Map<string, StrapiId[]>;
  /** Upload file URL (and its formats' URLs) → media source ID. */
  imageUrls: Map<string, string>;
};

const rowKey = (type: string, id: StrapiId) => `${type}#${id}`;
const push = <T>(map: Map<string, T[]>, key: string, value: T) =>
  map.set(key, [...(map.get(key) ?? []), value]);

const indexLinks = (links: readonly StrapiLink[]) => {
  const relations = new Map<string, LinkTarget[]>();
  const media = new Map<string, StrapiId[]>();
  for (const link of links) {
    const fileSide =
      link.left.type === UPLOAD_FILE ? link.left : link.right.type === UPLOAD_FILE ? link.right : undefined;
    if (fileSide) {
      const entity = fileSide === link.left ? link.right : link.left;
      if (entity.field) {
        push(media, `${rowKey(entity.type, entity.ref)}#${entity.field}`, fileSide.ref);
      }
      continue;
    }
    const owner = link.left.field ? link.left : link.right.field ? link.right : undefined;
    const target = owner === link.left ? link.right : link.left;
    if (owner?.field) {
      push(relations, `${rowKey(owner.type, owner.ref)}#${owner.field}`, {
        type: target.type,
        ref: target.ref,
      });
    }
  }
  return { relations, media };
};

const stringOf = (value: unknown) => (typeof value === 'string' ? value : undefined);
/** Strapi IDs and numeric scalars as text (objects are not scalars and give undefined). */
const textOf = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'bigint'
      ? String(value)
      : undefined;

/** Strapi's `name` may lack the extension (its example project's names do); `ext` always has it. */
const withExtension = (name: string, ext: string) =>
  name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;

const fileMedia = (data: Record<string, unknown>, root: string): ImportMedia | undefined => {
  const hash = stringOf(data.hash);
  const ext = stringOf(data.ext) ?? '';
  const id = textOf(data.id);
  if (!hash || id === undefined) {
    return undefined;
  }
  const alt = stringOf(data.alternativeText);
  const caption = stringOf(data.caption);
  const mimeType = stringOf(data.mime);
  const name = stringOf(data.name);
  return {
    sourceId: `file:${id}`,
    filename: name ? withExtension(name, ext) : `${hash}${ext}`,
    path: join(root, 'assets', 'uploads', `${hash}${ext}`),
    ...(mimeType ? { mimeType } : {}),
    ...(alt ? { alt } : {}),
    ...(caption ? { caption } : {}),
  };
};

/** Upload files (entities, or the assets' metadata files) and the URLs content uses for them. */
const collectMedia = (exported: StrapiExport) => {
  const rows = exported.entities
    .filter((entity) => entity.type === UPLOAD_FILE)
    .map((entity): Record<string, unknown> => ({ id: entity.id, ...entity.data }));
  const files =
    rows.length > 0 ? rows : exported.assetMetadata.filter((data) => !data.mainHash && !data.type);
  const media: ImportMedia[] = [];
  const imageUrls = new Map<string, string>();
  for (const data of files) {
    const item = fileMedia(data, exported.root);
    if (!item) {
      continue;
    }
    media.push(item);
    const formats = (data.formats ?? {}) as Record<string, { url?: string }>;
    for (const url of [stringOf(data.url), ...Object.values(formats).map((format) => format.url)]) {
      if (url) {
        imageUrls.set(url, item.sourceId);
      }
    }
  }
  return { media, imageUrls };
};

const imageResolver = (indexes: Indexes, resolver: ValueResolver) => (url: string) => {
  const sourceId =
    indexes.imageUrls.get(url) ?? indexes.imageUrls.get(new URL(url, 'http://strapi.invalid').pathname);
  return sourceId ? resolver.media(sourceId) : undefined;
};

const scalarValue = (attribute: AttributePlan, value: unknown): JsonValue | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  switch (attribute.type) {
    case 'datetime': {
      const text = textOf(value);
      const date = text === undefined ? undefined : new Date(text);
      return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
    }
    case 'decimal':
    case 'biginteger':
      return textOf(value);
    case 'json':
      return value as JsonValue;
    default:
      return typeof value === 'object' ? JSON.stringify(value) : (value as JsonValue);
  }
};

const entrySourceId = (type: string, documentId: string) => `strapi:${type}:${documentId}`;

const relationValue = (indexes: Indexes, key: string, many: boolean): SourceValue | undefined => {
  const sourceIds = [
    ...new Set(
      (indexes.relations.get(key) ?? []).flatMap((target) => {
        const documentId = indexes.documents.get(rowKey(target.type, target.ref));
        return documentId ? [entrySourceId(target.type, documentId)] : [];
      }),
    ),
  ];
  return sourceIds.length > 0 ? { kind: 'entries', sourceIds, many } : undefined;
};

const attributeValue = (
  indexes: Indexes,
  attribute: AttributePlan,
  value: unknown,
  linkKey: string,
): SourceValue | undefined => {
  switch (attribute.valueKind) {
    case 'scalar': {
      const scalar = scalarValue(attribute, value);
      return scalar === undefined ? undefined : { kind: 'scalar', value: scalar };
    }
    case 'markdown':
      return typeof value === 'string' && value.trim()
        ? {
            kind: 'richtext',
            convert: (resolver) => {
              const html = marked.parse(value, { async: false });
              const resolve = imageResolver(indexes, resolver);
              return htmlToRichText(html, { resolveImage: (image) => resolve(image.src) });
            },
          }
        : undefined;
    case 'blocks':
      return Array.isArray(value) && value.length > 0
        ? {
            kind: 'richtext',
            convert: (resolver) => blocksToRichText(value, imageResolver(indexes, resolver)),
          }
        : undefined;
    case 'relation':
      return relationValue(
        indexes,
        linkKey,
        attribute.attribute.relation?.endsWith('Many') === true || attribute.attribute.relation === 'manyWay',
      );
    case 'media': {
      const ids = indexes.media.get(linkKey) ?? [];
      return ids.length > 0
        ? {
            kind: 'media',
            sourceIds: ids.map((id) => `file:${String(id)}`),
            many: attribute.attribute.multiple === true,
          }
        : undefined;
    }
    case 'component':
      return componentValue(indexes, attribute, value);
    case 'zone':
      return zoneValue(indexes, value);
    default:
      return undefined;
  }
};

/** The fields of one row or component instance; links are looked up by its type and ID. */
const fieldsOf = (
  indexes: Indexes,
  plan: DefinitionPlan,
  data: Record<string, unknown>,
  id: StrapiId,
): SourceFields => {
  const fields: SourceFields = {};
  for (const attribute of plan.attributes) {
    const value = attributeValue(
      indexes,
      attribute,
      data[attribute.name],
      `${rowKey(plan.schema.uid, id)}#${attribute.name}`,
    );
    if (value) {
      fields[attribute.name] = value;
    }
  }
  return fields;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function componentValue(indexes: Indexes, attribute: AttributePlan, value: unknown): SourceValue | undefined {
  const plan = attribute.attribute.component ? indexes.plans.get(attribute.attribute.component) : undefined;
  const instances = (Array.isArray(value) ? value : [value]).filter(isRecord);
  if (!plan || instances.length === 0) {
    return undefined;
  }
  const items = instances.map((instance) => fieldsOf(indexes, plan, instance, instance.id as StrapiId));
  return { kind: 'component', items, many: attribute.attribute.repeatable === true };
}

function zoneValue(indexes: Indexes, value: unknown): SourceValue | undefined {
  const items = (Array.isArray(value) ? value : []).filter(isRecord).flatMap((instance) => {
    const uid = stringOf(instance.__component);
    const plan = uid ? indexes.plans.get(uid) : undefined;
    return plan && uid
      ? [{ component: uid, fields: fieldsOf(indexes, plan, instance, instance.id as StrapiId) }]
      : [];
  });
  return items.length > 0 ? { kind: 'zone', items } : undefined;
}

/** One entry per document: per locale, the draft row's content (the published row when there is no draft). */
const documentEntry = (
  indexes: Indexes,
  plan: DefinitionPlan,
  documentId: string,
  rows: StrapiEntity[],
): ImportEntry => {
  const localized = plan.definition.localized === true;
  const draftAndPublish = plan.schema.options?.draftAndPublish !== false;
  const byLocale = new Map<string | null, StrapiEntity[]>();
  for (const row of rows) {
    const locale = localized ? (stringOf(row.data.locale) ?? null) : null;
    byLocale.set(locale, [...(byLocale.get(locale) ?? []), row]);
  }
  const locales: ImportEntryLocale[] = [...byLocale].map(([locale, localeRows]) => {
    const row = localeRows.find((candidate) => !candidate.data.publishedAt) ?? localeRows[0]!;
    return {
      locale,
      fields: fieldsOf(indexes, plan, row.data, row.id),
      published: !draftAndPublish || localeRows.some((candidate) => Boolean(candidate.data.publishedAt)),
    };
  });
  const firstRow = rows[0]!;
  const title = plan.titleAttribute ? stringOf(firstRow.data[plan.titleAttribute]) : undefined;
  return {
    sourceId: entrySourceId(plan.schema.uid, documentId),
    definition: plan.schema.uid,
    title: title || `${plan.definition.apiKey} ${documentId}`,
    locales,
  };
};

const collectEntries = (indexes: Indexes, entities: readonly StrapiEntity[]): ImportEntry[] => {
  const documents = new Map<string, { plan: DefinitionPlan; documentId: string; rows: StrapiEntity[] }>();
  for (const entity of entities) {
    const plan = indexes.plans.get(entity.type);
    if (!plan || plan.definition.kind === 'component') {
      continue;
    }
    const documentId = indexes.documents.get(rowKey(entity.type, entity.id))!;
    const key = `${entity.type}#${documentId}`;
    const document = documents.get(key) ?? { plan, documentId, rows: [] };
    document.rows.push(entity);
    documents.set(key, document);
  }
  return [...documents.values()].map((document) =>
    documentEntry(indexes, document.plan, document.documentId, document.rows),
  );
};

export const strapiSource = (exported: StrapiExport): ImportSource => {
  const { plans, notes } = planStrapiSchema(exported.schemas);
  const { media, imageUrls } = collectMedia(exported);
  const documents = new Map(
    exported.entities.map((entity) => [
      rowKey(entity.type, entity.id),
      stringOf(entity.data.documentId) ?? String(entity.id),
    ]),
  );
  const indexes: Indexes = { plans, documents, ...indexLinks(exported.links), imageUrls };
  return {
    kind: 'strapi',
    definitions: [...plans.values()].map((plan) => plan.definition),
    media,
    entries: collectEntries(indexes, exported.entities),
    notes,
  };
};
