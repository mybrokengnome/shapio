import { join } from 'node:path';
import { strapiSource } from '../../import/strapi/adapter.js';
import { extractStrapiExport } from '../../import/strapi/archive.js';
import { readStrapiExport } from '../../import/strapi/exportFiles.js';
import { createImporterCommand } from './importers.js';

/** The unpacked export lives in the plan directory, so `--map` reads the same files without the key. */
const sourceDir = (dir: string) => join(dir, 'source');

/** `shapio import strapi`: a Strapi 5 export (`strapi export`) as models, components, media and drafts. */
export const importStrapiCommand = createImporterCommand({
  name: 'strapi',
  label: 'Strapi',
  summary: 'Import a Strapi 5 export: --plan writes schema files, --map creates drafts and change sets',
  usage:
    'shapio import strapi <export.tar.gz[.enc]> --plan <dir> [--key <encryption key>] [--site <key>] [--force]\n' +
    '       shapio import strapi --map <dir> [--url <origin>] [--token <admin token>] [--site <key>]\n' +
    '  --plan unpacks the export into <dir>/source (--key for an encrypted export) and writes the planned models\n' +
    '  and components (<dir>/schema) and <dir>/import-map.json; it sends nothing. With --site (or SHAPIO_SITE)\n' +
    '  they belong to that site (<dir>/schema/sites/<key>/); without, they are shared (--map\n' +
    '  without --site imports into the planned site). Apply the schema with\n' +
    '  `shapio schema apply --dir <dir>/schema --lock <dir>/schema-lock.json [--site <key>]`, then run --map:\n' +
    '  it uploads the media, creates every document as a draft and opens change sets with the published ones.\n' +
    '  Strapi 5 only.',
  options: ['key'],
  plan: async (file, dir, values) => {
    await extractStrapiExport(file, sourceDir(dir), typeof values.key === 'string' ? values.key : undefined);
    return strapiSource(await readStrapiExport(sourceDir(dir)));
  },
  load: async (_map, dir) => strapiSource(await readStrapiExport(sourceDir(dir))),
});
