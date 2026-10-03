import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ScaffoldError, toPackageName } from './scaffold.js';
import { PACKED_GITIGNORE, type SiteStarter } from './starters.js';

export type ScaffoldSiteOptions = {
  directory: string;
  site: SiteStarter;
  /** The packed templates (templates/ next to dist/ in the published package). */
  templatesDir: string;
};

/**
 * Writes a standalone site project from a starter template: the framework app, the blog's model files in
 * shapio/, and the seed and smoke scripts. Refuses to touch a non-empty directory. Returns the project path.
 */
export const scaffoldSite = ({ directory, site, templatesDir }: ScaffoldSiteOptions): string => {
  const root = resolve(directory);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new ScaffoldError(`${root} exists and is not empty`);
  }
  const template = join(templatesDir, site);
  if (!existsSync(join(template, 'package.json'))) {
    throw new ScaffoldError(
      `The ${site} template is missing from ${templatesDir}; build create-shapio first`,
    );
  }
  cpSync(template, root, { recursive: true });
  if (existsSync(join(root, PACKED_GITIGNORE))) {
    renameSync(join(root, PACKED_GITIGNORE), join(root, '.gitignore'));
  }
  const packagePath = join(root, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    packagePath,
    `${JSON.stringify({ ...packageJson, name: toPackageName(root), version: '0.1.0' }, null, 2)}\n`,
  );
  return root;
};
