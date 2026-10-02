import { toTypeName } from '@shapio/schema';

/**
 * One definition's declarations out of `shapio types generate`'s output (`GET /api/docs/typescript`): the
 * output type and its `…Input` type, each with its doc comment. Empty when the definition is not in it.
 */
const declarationOf = (source: string, name: string): string | undefined => {
  const start = source.indexOf(`export type ${name} = `);
  if (start < 0) {
    return undefined;
  }
  const commentStart = source.lastIndexOf('/**', start);
  const commentEnd = source.lastIndexOf('*/', start);
  // The doc comment directly above the declaration (only whitespace between them).
  const from =
    commentStart >= 0 && commentEnd > commentStart && source.slice(commentEnd + 2, start).trim() === ''
      ? commentStart
      : start;
  const end = source.indexOf('\n};\n', start);
  return end < 0 ? undefined : source.slice(from, end + 4);
};

export const declarationsOf = (source: string, apiKey: string): string => {
  const name = toTypeName(apiKey);
  return [declarationOf(source, name), declarationOf(source, `${name}Input`)]
    .filter((part): part is string => part !== undefined)
    .join('\n');
};
