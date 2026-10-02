import { describe, expect, it } from 'vitest';
import { declarationsOf } from './declarations';

const SOURCE = `// Generated

/** Article (collection \`article\`) */
export type Article = EntrySystemFields & {
  title: string | null;
};

/** Article (collection \`article\`) */
export type ArticleInput = {
  title?: string | null;
};

/** Author */
export type Author = EntrySystemFields & {
  name: string | null;
};
`;

describe('declarationsOf', () => {
  it('cuts one definition’s output and input types, with their doc comments', () => {
    const code = declarationsOf(SOURCE, 'article');
    expect(code).toContain('export type Article = ');
    expect(code).toContain('export type ArticleInput = ');
    expect(code).not.toContain('Author');
    expect(code.startsWith('/** Article')).toBe(true);
  });

  it('is empty for a definition that is not generated', () => {
    expect(declarationsOf(SOURCE, 'missing')).toBe('');
  });
});
