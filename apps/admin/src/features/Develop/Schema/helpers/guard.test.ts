import { hashDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildFiles } from './files';
import { guardApply } from './guard';
import { ARTICLE, AUTHOR, exportOf } from './testDefinitions';

const renamed = { ...ARTICLE, label: 'Post' };

const setup = async () => {
  const base = exportOf([
    { definition: ARTICLE, version: 3, hash: await hashDefinition(ARTICLE) },
    { definition: AUTHOR, version: 1, hash: await hashDefinition(AUTHOR) },
  ]);
  const [article] = buildFiles(base);
  if (!article) {
    throw new Error('no article file');
  }
  return {
    base,
    item: { file: article, local: { definition: renamed, hash: await hashDefinition(renamed) } },
  };
};

describe('guardApply (three-way, like shapio schema apply)', () => {
  it('turns a file changed only here into a draft based on the instance’s version', async () => {
    const { base, item } = await setup();
    const result = guardApply([item], base);
    expect(result).toEqual({
      status: 'ready',
      skipped: 0,
      drafts: [{ definitionId: ARTICLE.id, category: 'model', definition: renamed, baseVersion: 3 }],
    });
  });

  it('refuses when the definition also moved on the instance', async () => {
    const { item } = await setup();
    const moved = { ...ARTICLE, description: 'Changed elsewhere' };
    const remote = exportOf([{ definition: moved, version: 4, hash: await hashDefinition(moved) }]);
    const result = guardApply([item], remote);
    expect(result.status).toBe('conflict');
    expect(result.status === 'conflict' && result.conflicts[0]).toMatchObject({
      reason: 'changedOnBoth',
      remote: { version: 4 },
    });
  });

  it('skips a file the instance already has', async () => {
    const { item } = await setup();
    const remote = exportOf([{ definition: renamed, version: 4, hash: await hashDefinition(renamed) }]);
    expect(guardApply([item], remote)).toEqual({ status: 'ready', drafts: [], skipped: 1 });
  });

  it('refuses when the definition was deleted on the instance', async () => {
    const { item } = await setup();
    const result = guardApply([item], exportOf([]));
    expect(result.status === 'conflict' && result.conflicts[0]?.reason).toBe('deletedOnTarget');
  });
});
