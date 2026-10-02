import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { renderTemplates } from './templates.js';

export type ScaffoldOptions = {
  directory: string;
  shapioSpec: string;
  databaseUrl?: string;
};

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScaffoldError';
  }
}

/** npm package names: lowercase, URL-safe. Derived from the directory name. */
export const toPackageName = (directory: string): string =>
  basename(resolve(directory))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[-.]+$/g, '') || 'shapio-project';

/** Writes the project files. Refuses to touch a non-empty directory. Returns the absolute project path. */
export const scaffoldProject = ({ directory, shapioSpec, databaseUrl }: ScaffoldOptions): string => {
  const root = resolve(directory);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new ScaffoldError(`${root} exists and is not empty`);
  }
  const projectName = toPackageName(root);
  const files = renderTemplates({
    projectName,
    shapioSpec,
    databaseUrl:
      databaseUrl ?? `postgres://postgres:postgres@localhost:5432/${projectName.replace(/[^a-z0-9_]/g, '_')}`,
    sessionSecret: randomBytes(32).toString('base64url'),
  });
  for (const [path, content] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx' });
  }
  return root;
};
