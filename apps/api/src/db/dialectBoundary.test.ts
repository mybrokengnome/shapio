import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The dialect boundary (ADR 0001, "Dialect boundary"): database-specific SQL lives only in `db/` (its
 * primitives in `db/sql/`, migrations, locks, notifications, catalog queries) and in `content/compiler/`.
 * Every other source file uses Kysely's portable API and the `db/sql` primitives, so a second dialect is a
 * contained change.
 *
 * Kysely's row locks (`forUpdate`, `forShare`, `skipLocked`) are allowed everywhere: a single-writer dialect
 * (SQLite) drops them with a Kysely plugin, because its transactions are already serialised. `onConflict`
 * with a column target is portable; a named-constraint target is not.
 */
const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ALLOWED_DIRECTORIES = ['db/', 'content/compiler/'];

/** Files outside the allowed directories that may cross the boundary, each with its reason. Keep it empty. */
const ALLOWLIST: Readonly<Record<string, string>> = {};

const FORBIDDEN: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'the `sql` tag from kysely', pattern: /import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*'kysely'/ },
  { name: 'the pg driver', pattern: /from\s*'pg'/ },
  { name: "Kysely's PostgreSQL helpers", pattern: /kysely\/helpers\/(postgres|mysql|sqlite|mssql)/ },
  { name: 'DISTINCT ON', pattern: /\.distinctOn\(/ },
  { name: 'a LIKE operator (use the text primitives, which escape per dialect)', pattern: /'(not )?i?like'/ },
  { name: 'ON CONFLICT ON CONSTRAINT', pattern: /\.constraint\(/ },
  { name: 'a PostgreSQL SQLSTATE (use db/sql/errors)', pattern: /'(23505|23503|40001|40P01|55P03|57014)'/ },
  {
    name: 'a PostgreSQL-only type in a cast',
    pattern:
      /\.cast(<[^>]*>)?\([^;\n]*?'(timestamptz|jsonb|json|uuid|bigint|int4|int8|date|text\[\]|uuid\[\])'/,
  },
  {
    name: 'a PostgreSQL-only function',
    pattern:
      /fn(\.agg)?(<[^>]*>)?\(\s*'(to_char|timezone|split_part|array_agg|array_position|unnest|jsonb_\w+|json_\w+|greatest|least|now|nextval|setval|date_trunc|string_agg|gen_random_uuid|pg_\w+|to_regclass)'/,
  },
];

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });

/** Source without comments, so prose about SQL never trips the guard. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const violationsOf = (file: string) => {
  const source = withoutComments(readFileSync(file, 'utf8'));
  return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name);
};

const checkedFiles = sourceFiles(SOURCE_ROOT)
  .map((path) => relative(SOURCE_ROOT, path).split('\\').join('/'))
  .filter((file) => !ALLOWED_DIRECTORIES.some((directory) => file.startsWith(directory)));

describe('dialect boundary', () => {
  it('finds the source files', () => {
    expect(checkedFiles.length).toBeGreaterThan(100);
    expect(checkedFiles).toContain('repositories/jobs.ts');
  });

  it('keeps database-specific SQL in db/ and content/compiler/', () => {
    const violations = checkedFiles
      .filter((file) => ALLOWLIST[file] === undefined)
      .flatMap((file) => violationsOf(join(SOURCE_ROOT, file)).map((name) => `${file}: ${name}`));
    expect(violations).toEqual([]);
  });

  it('lists only files that still need their exception', () => {
    const stale = Object.keys(ALLOWLIST).filter((file) => violationsOf(join(SOURCE_ROOT, file)).length === 0);
    expect(stale).toEqual([]);
  });

  it('catches each forbidden construct', () => {
    const samples = [
      "import { sql, type Kysely } from 'kysely';",
      "import pg from 'pg';",
      "import { jsonArrayFrom } from 'kysely/helpers/postgres';",
      "qb.distinctOn('a')",
      "eb('email', 'ilike', pattern)",
      "oc.constraint('x_uq').doNothing()",
      "code === '23505'",
      "eb.cast(eb.val(at), 'timestamptz')",
      "eb.fn<string>('to_char', [])",
    ];
    for (const [index, sample] of samples.entries()) {
      expect(FORBIDDEN[index]?.pattern.test(sample), sample).toBe(true);
    }
  });
});
