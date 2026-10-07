import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { scaffoldProject, ScaffoldError } from './scaffold.js';
import { scaffoldSite } from './site.js';
import { isSiteStarter, SITE_STARTERS, type SiteStarter } from './starters.js';

const USAGE = `Usage: npx create-shapio <directory> [options]

Without --site: a Shapio project (the CMS server). With --site: a website that reads content from Shapio.

Options:
  --site <${SITE_STARTERS.join('|')}>  Create a site starter instead (a blog: pages, articles, authors)
  --database-url <url>   Database URL to put in .env (PostgreSQL, or sqlite:<path> for a single-process
                         install; CMS project only)
  --shapio-spec <spec>   Dependency spec for shapio (default: ^<this version>; a tarball path works too)
  --no-install           Skip npm install
  -h, --help             Show this help
`;

/** Packed from the repository's examples/ when create-shapio is built (templates/ beside dist/). */
const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));

const ownVersion = (): string => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return packageJson.version;
};

type Output = { out: (text: string) => void; err: (text: string) => void };

/** Returns the exit code. */
export const main = (argv: readonly string[], { out, err }: Output): number => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    allowNegative: true,
    options: {
      'database-url': { type: 'string' },
      'shapio-spec': { type: 'string' },
      site: { type: 'string' },
      install: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [directory] = positionals;
  if (values.help || !directory) {
    (directory ? out : err)(USAGE);
    return values.help ? 0 : 1;
  }
  const site = values.site;
  if (site !== undefined && !isSiteStarter(site)) {
    err(`create-shapio: --site must be one of ${SITE_STARTERS.join(', ')}\n`);
    return 1;
  }
  if (site !== undefined && (values['database-url'] || values['shapio-spec'])) {
    err('create-shapio: --database-url and --shapio-spec are for a CMS project, not --site\n');
    return 1;
  }
  let root: string;
  try {
    root = site
      ? scaffoldSite({ directory, site, templatesDir: TEMPLATES_DIR })
      : scaffoldProject({
          directory,
          shapioSpec: values['shapio-spec'] ?? `^${ownVersion()}`,
          ...(values['database-url'] ? { databaseUrl: values['database-url'] } : {}),
        });
  } catch (error) {
    if (error instanceof ScaffoldError) {
      err(`create-shapio: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  out(`Created a ${site ? `${site} site` : 'Shapio project'} in ${root}\n`);
  if (values.install) {
    out('Installing dependencies with npm...\n');
    const result = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
      err('create-shapio: npm install failed; run it yourself in the project directory\n');
      return 1;
    }
  }
  out(
    site ? siteNextSteps(directory, site) : projectNextSteps(directory, values['database-url'] !== undefined),
  );
  return 0;
};

const SERVE_COMMAND: Record<SiteStarter, string> = {
  astro: 'npm run preview',
  next: 'npm run start',
  sveltekit: 'npm run preview',
};

/** Points at DATABASE_URL only when --database-url did not already set it. */
const projectNextSteps = (directory: string, databaseUrlGiven: boolean) =>
  [
    '',
    'Next:',
    `  cd ${directory}`,
    ...(databaseUrlGiven ? [] : ['  edit .env (DATABASE_URL)']),
    '  npm run start',
    '',
  ].join('\n');

const siteNextSteps = (directory: string, site: SiteStarter) =>
  [
    '',
    'Next (with a running Shapio; README.md has the details):',
    `  cd ${directory}`,
    '  SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD=... npm run seed',
    '  npm run build',
    `  ${SERVE_COMMAND[site]}`,
    '',
  ].join('\n');
