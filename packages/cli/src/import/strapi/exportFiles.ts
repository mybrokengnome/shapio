import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * The files of an unpacked Strapi v5 export: `metadata.json` (with the Strapi version), and one JSON object per
 * line in `schemas/`, `entities/` and `links/`. Media bytes are under `assets/uploads/`, described by the
 * `plugin::upload.file` entities (or `assets/metadata/*.json`).
 */
export type StrapiAttribute = {
  type: string;
  relation?: string;
  target?: string;
  mappedBy?: string;
  inversedBy?: string;
  component?: string;
  components?: string[];
  repeatable?: boolean;
  multiple?: boolean;
  allowedTypes?: string[];
  enum?: string[];
  unique?: boolean;
  targetField?: string;
  private?: boolean;
  pluginOptions?: { i18n?: { localized?: boolean } };
};

export type StrapiSchema = {
  uid: string;
  modelType: 'contentType' | 'component';
  kind?: 'collectionType' | 'singleType';
  category?: string;
  info?: { singularName?: string; pluralName?: string; displayName?: string; description?: string };
  options?: { draftAndPublish?: boolean };
  pluginOptions?: { i18n?: { localized?: boolean } };
  attributes: Record<string, StrapiAttribute>;
};

export type StrapiId = number | string;
export type StrapiEntity = { type: string; id: StrapiId; data: Record<string, unknown> };
export type StrapiLinkSide = { type: string; ref: StrapiId; field?: string; pos?: number };
export type StrapiLink = { kind?: string; relation?: string; left: StrapiLinkSide; right: StrapiLinkSide };

export type StrapiExport = {
  /** The directory holding `metadata.json`. */
  root: string;
  version: string;
  schemas: StrapiSchema[];
  entities: StrapiEntity[];
  links: StrapiLink[];
  /** `assets/metadata/*.json`, used when the export has no upload file entities. */
  assetMetadata: Array<Record<string, unknown>>;
};

export class UnsupportedExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedExportError';
  }
}

const isMissing = (error: unknown) => (error as { code?: string }).code === 'ENOENT';

/** The export's root: the extraction directory, or its only subdirectory. */
const findRoot = async (dir: string): Promise<string> => {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'metadata.json')) {
    return dir;
  }
  const subdirectories = entries.filter((entry) => entry.isDirectory());
  for (const subdirectory of subdirectories) {
    const candidate = join(dir, subdirectory.name);
    if ((await readdir(candidate)).includes('metadata.json')) {
      return candidate;
    }
  }
  throw new UnsupportedExportError('The archive has no metadata.json: is it a `strapi export` file?');
};

const readJsonLines = async <T>(dir: string): Promise<T[]> => {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  const items: T[] = [];
  for (const name of names) {
    const lines = createInterface({ input: createReadStream(join(dir, name), 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim()) {
        items.push(JSON.parse(line) as T);
      }
    }
  }
  return items;
};

const readAssetMetadata = async (root: string) => {
  const dir = join(root, 'assets', 'metadata');
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, unknown>),
  );
};

/** Strapi v5 only: v4 exports have another document model (no document IDs) and are refused. */
const checkVersion = (metadata: { strapi?: { version?: string } }) => {
  const version = metadata.strapi?.version ?? '';
  const major = Number.parseInt(version, 10);
  if (major === 5) {
    return version;
  }
  throw new UnsupportedExportError(
    major === 4
      ? `This is a Strapi ${version} export. Only Strapi 5 exports are supported: upgrade the project to Strapi 5 (npx @strapi/upgrade major), then export again.`
      : `Unsupported export: Strapi version "${version || 'unknown'}" (only Strapi 5 exports are supported).`,
  );
};

export const readStrapiExport = async (dir: string): Promise<StrapiExport> => {
  const root = await findRoot(dir);
  const metadata = JSON.parse(await readFile(join(root, 'metadata.json'), 'utf8')) as {
    strapi?: { version?: string };
  };
  const version = checkVersion(metadata);
  return {
    root,
    version,
    schemas: await readJsonLines<StrapiSchema>(join(root, 'schemas')),
    entities: await readJsonLines<StrapiEntity>(join(root, 'entities')),
    links: await readJsonLines<StrapiLink>(join(root, 'links')),
    assetMetadata: await readAssetMetadata(root),
  };
};
