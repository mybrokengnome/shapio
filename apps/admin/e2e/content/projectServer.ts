import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scaffoldProject } from '../../../../packages/create-shapio/src/scaffold';
import { ARTIFACTS_DIR, E2E_BASE_PATH, E2E_DATABASE } from '../support/constants';
import { createDatabase, databaseUrlOf, dropDatabase } from '../support/testDatabases';

/**
 * The content suite runs against its own Shapio: a project scaffolded by `create-shapio`, with the example
 * custom editor (examples/custom-editor, built here with its own Vite config, outside the admin bundle)
 * copied into `extensions/editors/` and listed in `shapio.config.ts`, exactly as a user installs one. The
 * server runs from source with that project as its working directory, on its own database and port, so
 * this suite neither depends on nor disturbs the shared server the other specs use.
 */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const EXAMPLE_DIR = join(REPO_ROOT, 'examples', 'custom-editor');
const TSX_LOADER = pathToFileURL(join(API_DIR, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
const POLL_MS = 200;

export type ProjectServer = {
  origin: string;
  adminUrl: string;
  adminApi: string;
  projectDir: string;
  readLog: () => string;
  stop: () => Promise<void>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });

/** Builds the example editor with Vite's API and its own config: one ESM file importing react + the SDK. */
const buildExampleEditor = async (): Promise<string> => {
  const { build } = await import('vite');
  await build({ root: EXAMPLE_DIR, configFile: join(EXAMPLE_DIR, 'vite.config.ts'), logLevel: 'warn' });
  return join(EXAMPLE_DIR, 'dist', 'star-rating.js');
};

/** `npx create-shapio`, then install the editor: copy the file, list it in shapio.config.ts. */
const scaffoldWithEditor = (editorFile: string, name: string): string => {
  const projectDir = join(ARTIFACTS_DIR, `${name}-project`);
  rmSync(projectDir, { recursive: true, force: true });
  scaffoldProject({ directory: projectDir, shapioSpec: 'file:../../shapio' });
  copyFileSync(editorFile, join(projectDir, 'extensions', 'editors', 'star-rating.js'));
  const configFile = join(projectDir, 'shapio.config.ts');
  const config = readFileSync(configFile, 'utf8');
  if (!config.includes('editors: []')) {
    throw new Error('The create-shapio template changed: shapio.config.ts has no `editors: []`');
  }
  writeFileSync(configFile, config.replace('editors: []', "editors: ['star-rating.js']"));
  return projectDir;
};

type ProjectServerOptions = {
  /** Extra environment for this server only (e.g. assist's AI_* settings pointing at a fake provider). */
  env?: Readonly<Record<string, string>>;
};

/**
 * Starts a project server. `name` keeps each suite's project directory, database and log apart, so a
 * suite that needs a fresh instance (empty models and media) never shares state with another.
 */
export const startProjectServer = async (
  name = 'content',
  { env = {} }: ProjectServerOptions = {},
): Promise<ProjectServer> => {
  const projectDir = scaffoldWithEditor(await buildExampleEditor(), name);
  const database = `${E2E_DATABASE}_${name}`;
  await createDatabase(database);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const logPath = join(ARTIFACTS_DIR, `${name}-server.log`);
  const log = createWriteStream(logPath);
  const server: ChildProcess = spawn(
    process.execPath,
    ['--conditions=@shapio/source', '--import', TSX_LOADER, join(API_DIR, 'src', 'main.ts')],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(port),
        BASE_PATH: E2E_BASE_PATH,
        PUBLIC_URL: origin,
        DATABASE_URL: databaseUrlOf(database),
        MIGRATE_ON_START: 'true',
        LOG_LEVEL: 'info',
        LOG_PRETTY: 'false',
        RATE_LIMIT_MAX: '5000',
        EMAIL_TRANSPORT: 'console',
        MEDIA_PATH: join(projectDir, 'media'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  const readLog = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '');
  const deadline = Date.now() + 60_000;
  while (!/Server listening/.test(readLog())) {
    if (Date.now() > deadline || server.exitCode !== null) {
      throw new Error(`The project server did not start; see ${logPath}`);
    }
    await sleep(POLL_MS);
  }
  return {
    origin,
    adminUrl: `${origin}${E2E_BASE_PATH}/admin/`,
    adminApi: `${origin}${E2E_BASE_PATH}/api/admin`,
    projectDir,
    readLog,
    stop: async () => {
      server.kill('SIGTERM');
      await sleep(1500);
      await dropDatabase(database);
    },
  };
};
