import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { scaffoldProject, ScaffoldError } from './scaffold.js';

const USAGE = `Usage: npx create-shapio <directory> [options]

Options:
  --database-url <url>   PostgreSQL connection string to put in .env
  --shapio-spec <spec>   Dependency spec for shapio (default: ^<this version>; a tarball path works too)
  --no-install           Skip npm install
  -h, --help             Show this help
`;

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
      install: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [directory] = positionals;
  if (values.help || !directory) {
    (directory ? out : err)(USAGE);
    return values.help ? 0 : 1;
  }
  let root: string;
  try {
    root = scaffoldProject({
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
  out(`Created a Shapio project in ${root}\n`);
  if (values.install) {
    out('Installing dependencies with npm...\n');
    const result = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
      err('create-shapio: npm install failed; run it yourself in the project directory\n');
      return 1;
    }
  }
  out(`\nNext:\n  cd ${directory}\n  edit .env (DATABASE_URL)\n  npm run start\n`);
  return 0;
};
