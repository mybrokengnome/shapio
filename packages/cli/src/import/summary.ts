import { isAbsolute, relative } from 'node:path';
import type { SchemaDefinition } from '@shapio/schema';
import { PLAN_LOCK_FILE, PLAN_SCHEMA_DIR } from './planner.js';
import type { ImportSource } from './types.js';

/** Relative to the working directory when inside it, else absolute (what to paste into the next command). */
const display = (path: string) => {
  const shown = relative(process.cwd(), path);
  return !shown ? '.' : shown.startsWith('..') || isAbsolute(shown) ? path : shown;
};

/** What `--plan` wrote and what to do next. */
export const formatPlanSummary = (
  source: ImportSource,
  definitions: readonly SchemaDefinition[],
  dir: string,
  command: string,
): string => {
  const keyOf = new Map(source.definitions.map((definition) => [definition.apiKey, definition.key]));
  const lines = [`Planned ${definitions.length} definition(s) in ${display(`${dir}/${PLAN_SCHEMA_DIR}`)}:`];
  for (const definition of definitions) {
    const entries = source.entries.filter((entry) => entry.definition === keyOf.get(definition.apiKey));
    const published = entries.filter((entry) => entry.locales.some((locale) => locale.published)).length;
    lines.push(
      `  ${definition.kind === 'component' ? 'component' : 'model'} ${definition.apiKey}: ${definition.fields.length} field(s)` +
        (definition.kind === 'component'
          ? ''
          : `, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (${published} published, ${entries.length - published} draft(s))`),
    );
  }
  lines.push(`Media: ${source.media.length} file(s) to import.`);
  lines.push(
    'Every model has draft and publish on: nothing goes live until you ship the change set(s) the import opens.',
  );
  lines.push(...source.notes);
  lines.push(
    'Next:',
    '  1. Review the files: rename API IDs or delete fields you do not want (entries follow the stable IDs).',
    `  2. shapio schema apply --dir ${display(`${dir}/${PLAN_SCHEMA_DIR}`)} --lock ${display(`${dir}/${PLAN_LOCK_FILE}`)}`,
    `  3. shapio import ${command} --map ${display(dir)}`,
  );
  return `${lines.join('\n')}\n`;
};
