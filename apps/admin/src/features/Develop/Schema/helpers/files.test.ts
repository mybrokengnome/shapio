import { LOCK_FILE_PATH, parseLockFile, serializeDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildFiles, buildLockText, definitionFilePath } from './files';
import { ARTICLE, AUTHOR, exportOf, SEO } from './testDefinitions';

const exported = exportOf([
  { definition: SEO, version: 1, hash: 'sha256:seo' },
  { definition: ARTICLE, version: 4, hash: 'sha256:article' },
  { definition: AUTHOR, version: 2, hash: 'sha256:author' },
]);

describe('schema files', () => {
  it('uses the CLI layout: schema/models, schema/components, the lock file under .shapio', () => {
    expect(definitionFilePath(ARTICLE)).toBe('schema/models/article.json');
    expect(definitionFilePath(SEO)).toBe('schema/components/seo.json');
    expect(LOCK_FILE_PATH).toBe('.shapio/schema-lock.json');
  });

  it('lists models then components by path, with the canonical bytes pull writes', () => {
    const files = buildFiles(exported);
    expect(files.map((file) => file.path)).toEqual([
      'schema/models/article.json',
      'schema/models/author.json',
      'schema/components/seo.json',
    ]);
    expect(files[0]?.base).toMatchObject({
      version: 4,
      hash: 'sha256:article',
      text: serializeDefinition(ARTICLE),
    });
    expect(files[2]?.category).toBe('component');
  });

  it('writes a lock file the CLI parses', () => {
    const lock = parseLockFile(buildLockText(exported));
    expect(lock.schemaVersion).toBe(7);
    expect(lock.definitions[ARTICLE.id]).toEqual({
      kind: 'collection',
      apiKey: 'article',
      version: 4,
      hash: 'sha256:article',
    });
  });
});
