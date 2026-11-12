import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The writers of `entry_heads.data`, audited for the item ID cache (content/itemIdCache.ts, plan item-ids-perf).
 * The cache is keyed by the stored value itself (a digest of its JSON text), the schema the derivation reads, the
 * entry, the scope's locale and the instance key, never by which writer wrote the value or by a version column, so
 * no writer can leave an entry stale: a value whose bytes differ is another key. This list records that each
 * writer was checked against that argument. A new writer, or another call in an audited file, fails this test:
 * check it still only writes `data` through the database (never mutates a row object a read already holds, and
 * never changes what the derivation reads outside `data`, the entry ID, the locale and the schema), then add it.
 */
const AUDITED: ReadonlyArray<{ file: string; pattern: string; count: number; why: string }> = [
  {
    file: 'repositories/entryHeads.ts',
    pattern: 'table',
    count: 4,
    why: 'insert, update (saves, autosave, publish), rewriteData (activation, with and without a revision), changeModel (change kind): all write the data column only through SQL',
  },
  {
    file: 'repositories/transferImport.ts',
    pattern: 'table',
    count: 2,
    why: 'insertHead, moveHead (import): bundle data written as given',
  },
  {
    file: 'repositories/contentPurge.ts',
    pattern: 'table',
    count: 1,
    why: 'moveEntriesToLocale (locale purge): moves heads to another locale, data unchanged; the locale is in the key',
  },
  {
    file: 'content/write/heads.ts',
    pattern: 'repo',
    count: 5,
    why: 'writeDraft (save, autosave, fan-out, restore, duplicate), publishDraft (autosave revision + published head), movePublishedHead (publish, restore to snapshot)',
  },
  {
    file: 'content/write/heads.ts',
    pattern: 'helpers',
    count: 2,
    why: 'movePublishedHead from publishDraft and publishRevision',
  },
  {
    file: 'content/migration/apply.ts',
    pattern: 'repo',
    count: 1,
    why: 'rewriteHead: activation conversions, with a conversion revision',
  },
  {
    file: 'content/migration/entryConversions.ts',
    pattern: 'repo',
    count: 1,
    why: 'unifyField: a field made shared, rewriteData without a revision (keeps version and change_seq; the data digest still moves)',
  },
  {
    file: 'content/migration/entryConversions.ts',
    pattern: 'helpers',
    count: 1,
    why: 'publishAll: a model stops having drafts',
  },
  {
    file: 'content/transfer/importEntry.ts',
    pattern: 'importRepo',
    count: 2,
    why: 'writeHead: import of a bundle head (insert or move)',
  },
  {
    file: 'content/localePurge.ts',
    pattern: 'purge',
    count: 1,
    why: 'locale removal moves entries only in that locale to the default locale',
  },
  {
    file: 'services/contentEntries.ts',
    pattern: 'helpers',
    count: 3,
    why: 'saveDraftChanges (create, update, autosave, fan-out of shared fields, restore), duplicate',
  },
  {
    file: 'services/contentKind.ts',
    pattern: 'repo',
    count: 1,
    why: 'change kind: new model, data and revision',
  },
  {
    file: 'services/contentPublishing.ts',
    pattern: 'helpers',
    count: 2,
    why: 'publish (publishDraft), restore to snapshot (publishRevision); change sets and schedules reach these',
  },
  {
    file: 'db/migrations/20261005120000_entry_heads_entry_created_at.ts',
    pattern: 'rawSql',
    count: 1,
    why: 'backfills entry_created_at; never writes data',
  },
  {
    file: 'db/migrations/mysql/20261005120000_entry_heads_entry_created_at.ts',
    pattern: 'rawSql',
    count: 1,
    why: 'MySQL twin of the above',
  },
  {
    file: 'db/migrations/sqlite/20261005120000_entry_heads_entry_created_at.ts',
    pattern: 'rawSql',
    count: 1,
    why: 'SQLite twin of the above',
  },
  {
    file: 'db/contentFilterIndex.ts',
    pattern: 'rawSql',
    count: 1,
    why: 'fillFilterDataBatch: fills filter_data (PostgreSQL); never writes data',
  },
];

const PATTERNS: Readonly<Record<string, RegExp>> = {
  table: /(updateTable|insertInto)\(\s*.entry_heads.\s*\)/g,
  rawSql: /\b(update|insert\s+into)\s+["`\\]*entry_heads\b/gi,
  repo: /entryHeadsRepository\.(insert|update|rewriteData|changeModel)\(/g,
  importRepo: /transferImportRepository\.(insertHead|moveHead)\(/g,
  purge: /contentPurgeRepository\.moveEntriesToLocale\(/g,
  helpers: /\b(writeDraft|publishDraft|publishRevision|movePublishedHead)\(/g,
};

const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('item ID cache: writers of entry_heads.data', () => {
  it('finds exactly the audited writers', () => {
    const found = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const source = withoutComments(readFileSync(path, 'utf8'));
      const file = relative(SOURCE_ROOT, path).split('\\').join('/');
      return Object.entries(PATTERNS).flatMap(([pattern, regex]) => {
        const count = source.match(regex)?.length ?? 0;
        return count > 0 ? [`${file} ${pattern} ${count}`] : [];
      });
    });
    expect(found.sort()).toEqual(
      AUDITED.map(({ file, pattern, count }) => `${file} ${pattern} ${count}`).sort(),
    );
  });
});
