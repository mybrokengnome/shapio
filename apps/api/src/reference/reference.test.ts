import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUPS, NOTES, readSchemaComments, schemaVariables } from './environment.js';
import { REFERENCE_PAGES, REPOSITORY_ROOT } from './index.js';

describe('generated documentation', () => {
  it.each(REFERENCE_PAGES.map((page) => [page.path, page] as const))(
    '%s matches its generator (run `pnpm docs:reference` after changing config, commands or the OpenAPI generator)',
    async (_path, page) => {
      expect(readFileSync(join(REPOSITORY_ROOT, page.path), 'utf8')).toBe(await page.render());
    },
  );

  it('documents every variable of config/schema.ts exactly once, each with a description', () => {
    const variables = schemaVariables();
    const grouped = GROUPS.flatMap((group) => group.keys);
    expect([...grouped].sort()).toEqual([...variables].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    const comments = readSchemaComments();
    expect(variables.filter((name) => !comments.has(name) && !NOTES[name])).toEqual([]);
    // A note for a variable that has (or no longer exists in) the schema is stale.
    expect(Object.keys(NOTES).filter((name) => comments.has(name) || !variables.includes(name))).toEqual([]);
  });
});
