import { resolve } from 'node:path';
import { wordpressSource } from '../../import/wordpress/adapter.js';
import { readWxr } from '../../import/wordpress/wxr.js';
import { createImporterCommand, type ImporterValues } from './importers.js';

const mediaDirOf = (values: ImporterValues) =>
  typeof values['media-dir'] === 'string' ? { mediaDir: resolve(values['media-dir']) } : {};

/** `shapio import wordpress`: a WordPress export (WXR, Tools → Export) as models, media and drafts. */
export const importWordPressCommand = createImporterCommand({
  name: 'wordpress',
  label: 'WordPress',
  summary:
    'Import a WordPress export (WXR): --plan writes schema files, --map creates drafts and change sets',
  usage:
    'shapio import wordpress <export.xml> --plan <dir> [--site <key> | --shared] [--url <origin> --token <admin token>] [--force]\n' +
    '       shapio import wordpress --map <dir> [--url <origin>] [--token <admin token>] [--site <key>] [--media-dir <uploads dir>]\n' +
    '  --plan reads the export and writes the planned models (<dir>/schema) and <dir>/import-map.json.\n' +
    '  With --url it checks the planned API IDs against that instance and renames clashes (tag → tagItem);\n' +
    '  without it, it sends nothing.\n' +
    '  The models belong to one site (<dir>/schema/sites/<key>/): --site (or SHAPIO_SITE), else the primary site\n' +
    '  ("default"); --shared shares them with all sites (applying them needs a network admin token).\n' +
    '  --map without --site imports into the planned site.\n' +
    '  Apply the models with `shapio schema apply --dir <dir>/schema --lock <dir>/schema-lock.json [--site <key>]`, then run --map:\n' +
    '  it uploads the media (downloaded from the site, or read from --media-dir, a copy of wp-content/uploads),\n' +
    '  creates every post and page as a draft, and opens change sets with the published ones. Re-run --map to resume.',
  options: ['media-dir'],
  plan: async (file) => wordpressSource(await readWxr(file)),
  load: async (map, _dir, values) => wordpressSource(await readWxr(map.source.path), mediaDirOf(values)),
});
