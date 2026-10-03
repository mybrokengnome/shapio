import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { PACKED_GITIGNORE, SITE_STARTERS } from '../starters.js';
import { parseCatalog } from './catalog.js';
import { listFiles } from './files.js';
import {
  findRepositoryMarkers,
  rewritePackageJson,
  rewriteScriptSource,
  rewriteTsconfig,
  TemplateError,
  type PackageJson,
  type VersionSources,
} from './rewrite.js';

/**
 * Packs examples/{astro,next,sveltekit} into create-shapio's templates/ (run by `build` and `prepack`). Each
 * template is the starter plus what the starters share (examples/shared: the model files in shapio/ and the
 * seed and smoke scripts in scripts/), rewritten into a standalone npm project (see rewrite.ts).
 */
export type PackOptions = { repoRoot: string; outDir: string };

/** Shared directories copied into every starter, under the same names. */
const SHARED_DIRECTORIES = ['shapio', 'scripts'] as const;

const readJson = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

/** Name → version of every workspace package (apps/* and packages/*). */
export const readWorkspaceVersions = (repoRoot: string): Record<string, string> => {
  const versions: Record<string, string> = {};
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(repoRoot, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const { name, version } = readJson<{ name?: string; version?: string }>(
          join(repoRoot, group, entry.name, 'package.json'),
        );
        if (name && version) {
          versions[name] = version;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }
  return versions;
};

/** The content a file gets in the template, by its path in the template. */
export const transformFile = (path: string, content: string, versions: VersionSources): string => {
  if (path === 'package.json') {
    return `${JSON.stringify(rewritePackageJson(JSON.parse(content) as PackageJson, versions), null, 2)}\n`;
  }
  if (path === 'tsconfig.json') {
    return rewriteTsconfig(content);
  }
  if (path.startsWith('scripts/') && path.endsWith('.ts')) {
    return rewriteScriptSource(content);
  }
  return content;
};

/** Copied byte for byte; everything else is text that may be rewritten. */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff2',
]);

/** Where a file lands in the template (`.gitignore` is carried as `gitignore`). */
export const templatePath = (path: string) => (path === '.gitignore' ? PACKED_GITIGNORE : path);

const packStarter = (repoRoot: string, outDir: string, starter: string, versions: VersionSources) => {
  const starterDir = join(repoRoot, 'examples', starter);
  const sources = listFiles(starterDir).map((path) => ({ path, from: join(starterDir, path) }));
  for (const directory of SHARED_DIRECTORIES) {
    const sharedDir = join(repoRoot, 'examples', 'shared', directory);
    for (const path of listFiles(sharedDir)) {
      sources.push({ path: `${directory}/${path}`, from: join(sharedDir, path) });
    }
  }
  const target = join(outDir, starter);
  for (const { path, from } of sources) {
    const destination = join(target, templatePath(path));
    mkdirSync(dirname(destination), { recursive: true });
    if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) {
      writeFileSync(destination, readFileSync(from), { flag: 'wx' });
      continue;
    }
    const content = transformFile(path, readFileSync(from, 'utf8'), versions);
    const markers = findRepositoryMarkers(content);
    if (markers.length > 0) {
      throw new TemplateError(`${starter}/${path} still contains ${markers.join(', ')} after packing`);
    }
    // `wx`: a starter file and a shared file with the same path is a packing error, not a silent overwrite.
    writeFileSync(destination, content, { flag: 'wx' });
  }
  return sources.length;
};

/** Rewrites outDir from scratch. Returns the number of files per starter. */
export const packTemplates = ({ repoRoot, outDir }: PackOptions): Record<string, number> => {
  const versions: VersionSources = {
    workspace: readWorkspaceVersions(repoRoot),
    catalog: parseCatalog(readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')),
  };
  rmSync(outDir, { recursive: true, force: true });
  return Object.fromEntries(
    SITE_STARTERS.map((starter) => [starter, packStarter(repoRoot, outDir, starter, versions)]),
  );
};
