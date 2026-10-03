// Smoke test for the npm install path (build plan §4.A Done):
//   1. pack `shapio` (prepack builds it and copies the admin bundle in) and `create-shapio`;
//   2. install the shapio tarball in an empty directory and run `npx shapio start` until /api/ready is 200;
//   3. scaffold a project with the create-shapio tarball, copy examples/extension into it, check it with
//      `npx shapio extensions check`, run `npm run start` until /api/ready is 200, and probe the custom route;
//   4. scaffold each site starter (`create-shapio --site`) and check it is a standalone project: no workspace,
//      catalog or source-condition references left, and a .gitignore;
//   5. install the scaffolded Next.js starter with the packed `@shapio/schema`, `@shapio/client` and
//      `@shapio/visual`, seed it against the project from step 3 (started again) and run its `npm run build`.
// Each run gets its own database, created and dropped on the server named by TEST_DATABASE_URL.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
// Read TEST_DATABASE_URL from the repo .env without loading the rest of it into child processes.
const dotenv = existsSync(join(root, '.env')) ? parseEnv(readFileSync(join(root, '.env'), 'utf8')) : {};
const adminUrl = process.env.TEST_DATABASE_URL ?? dotenv.TEST_DATABASE_URL;
if (!adminUrl) {
  throw new Error('TEST_DATABASE_URL is required (a maintenance database such as postgres)');
}
const pg = createRequire(join(root, 'apps/api/package.json'))('pg');

// A scaffolded project reads DATABASE_URL from its own .env; a real env var would override it.
const { DATABASE_URL: _dropped, ...childBaseEnv } = process.env;

const log = (message) => process.stdout.write(`[smoke] ${message}\n`);

const run = (command, args, cwd, env = {}) => {
  log(`$ ${command} ${args.join(' ')}  (in ${cwd})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...childBaseEnv, ...env } });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
};

const admin = async (statement) => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
};

const databaseUrl = (name) => {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
};

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const waitForReady = async (url, child, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`process exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/api/ready`);
      if (response.status === 200) {
        return response.json();
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url}/api/ready not 200 within ${timeoutMs}ms`);
};

/**
 * Starts `command`, waits for readiness, checks /api/version (and `probe`), then SIGTERMs; expects exit 0.
 * `env` is an object, or a function of the server's URL (for a PUBLIC_URL that matches the free port).
 */
const startAndProbe = async (label, command, args, cwd, env, probe = async () => {}) => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  log(`${label}: $ ${command} ${args.join(' ')} on ${url}`);
  const extraEnv = typeof env === 'function' ? env(url) : env;
  const child = spawn(command, args, {
    cwd,
    env: { ...childBaseEnv, ...extraEnv, PORT: String(port), HOST: '127.0.0.1', LOG_PRETTY: 'false' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exited = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })));
  try {
    const ready = await waitForReady(url, child);
    const version = await (await fetch(`${url}/api/version`)).json();
    log(`${label}: ready ${JSON.stringify(ready)} version ${JSON.stringify(version)}`);
    await probe(url);
  } finally {
    child.kill('SIGTERM');
  }
  const { code, signal } = await exited;
  // npm run / npx forward the signal; the server exits 0 after a graceful shutdown.
  if (code !== 0 && signal !== 'SIGTERM') {
    throw new Error(`${label}: exited with code ${code} signal ${signal}`);
  }
  log(`${label}: stopped (code ${code}, signal ${signal})`);
};

const SITE_STARTERS = ['astro', 'next', 'sveltekit'];
const REPOSITORY_ONLY = ['workspace:', 'catalog:', '@shapio/source', '../shared/'];

const filesUnder = (directory) =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

const checkSiteStarter = (createTgz, work, starter) => {
  run(
    'npm',
    [
      'exec',
      '--yes',
      `--package=${createTgz}`,
      '--',
      'create-shapio',
      `site-${starter}`,
      '--site',
      starter,
      '--no-install',
    ],
    work,
  );
  const project = join(work, `site-${starter}`);
  for (const required of [
    '.gitignore',
    'package.json',
    'scripts/seed.ts',
    'shapio/models/siteSettings.json',
  ]) {
    if (!existsSync(join(project, required))) {
      throw new Error(`create-shapio --site ${starter}: ${required} is missing`);
    }
  }
  for (const file of filesUnder(project)) {
    const found = REPOSITORY_ONLY.filter((marker) => readFileSync(file, 'utf8').includes(marker));
    if (found.length > 0) {
      throw new Error(
        `create-shapio --site ${starter}: ${file} still refers to the repository (${found.join(', ')})`,
      );
    }
  }
  log(`create-shapio --site ${starter}: standalone project scaffolded`);
};

const SITE_ADMIN_EMAIL = 'site-smoke@example.com';
const SITE_ADMIN_PASSWORD = 'npm-smoke-site-starter-password';
/** The workspace packages a scaffolded starter installs from npm; the smoke packs them instead. */
const SITE_PACKAGES = ['@shapio/schema', '@shapio/client', '@shapio/visual'];

/**
 * The scaffolded Next.js starter as a user runs it: `npm install` (with the packed workspace packages, which
 * are not on the registry for an unreleased version), `npm run seed` against a running Shapio, `npm run build`.
 */
const buildNextStarter = (siteTarballs, shapioUrl) => {
  const site = join(work, 'site-next');
  const started = Date.now();
  run('npm', ['install', '--no-audit', '--no-fund', ...siteTarballs], site);
  run('npm', ['run', 'seed'], site, {
    SHAPIO_URL: shapioUrl,
    SHAPIO_ADMIN_EMAIL: SITE_ADMIN_EMAIL,
    SHAPIO_ADMIN_PASSWORD: SITE_ADMIN_PASSWORD,
  });
  run('npm', ['run', 'build'], site);
  log(
    `create-shapio --site next: installed, seeded and built in ${Math.round((Date.now() - started) / 1000)}s`,
  );
};

const work = mkdtempSync(join(tmpdir(), 'shapio-smoke-'));
const databases = [`shapio_smoke_npx_${process.pid}`, `shapio_smoke_create_${process.pid}`];
try {
  const tarballs = join(work, 'tarballs');
  // A fresh clone has no dist/ anywhere: build what gets packed (and its workspace dependencies) first.
  const sitePackageFilters = SITE_PACKAGES.flatMap((name) => ['--filter', name]);
  run('pnpm', ['--filter', 'shapio...', '--filter', 'create-shapio', ...sitePackageFilters, 'build'], root);
  run('pnpm', ['--filter', 'shapio', 'pack', '--pack-destination', tarballs], root);
  run('pnpm', ['--filter', 'create-shapio', 'pack', '--pack-destination', tarballs], root);
  run('pnpm', [...sitePackageFilters, 'pack', '--pack-destination', tarballs], root);
  /** `<name>-<version>.tgz`, matched on the name exactly (`shapio-` is also the start of `shapio-client-`). */
  const tarball = (name) =>
    join(
      tarballs,
      readdirSync(tarballs).find(
        (file) => file.startsWith(`${name}-`) && /^\d/.test(file.slice(name.length + 1)),
      ),
    );
  const shapioTgz = tarball('shapio');
  const createTgz = tarball('create-shapio');
  // pnpm names a scoped package's tarball `<scope>-<name>-<version>.tgz`.
  const siteTarballs = SITE_PACKAGES.map((name) => tarball(name.slice(1).replace('/', '-')));

  run('tar', ['-tzf', shapioTgz, 'package/dist/admin/index.html', 'package/dist/cli.js'], work);

  for (const name of databases) {
    await admin(`create database ${pg.escapeIdentifier(name)}`);
  }

  // 1. npm install + npx shapio start
  const plain = join(work, 'plain');
  run('mkdir', ['-p', plain], work);
  writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plain', private: true }));
  run('npm', ['install', '--no-audit', '--no-fund', shapioTgz], plain);
  await startAndProbe('npx shapio start', 'npx', ['shapio', 'start'], plain, {
    DATABASE_URL: databaseUrl(databases[0]),
    PUBLIC_URL: 'http://localhost:4300',
  });

  // 2. create-shapio scaffold + npm run start (DATABASE_URL comes from the generated .env)
  run(
    'npm',
    [
      'exec',
      '--yes',
      `--package=${createTgz}`,
      '--',
      'create-shapio',
      'my-cms',
      `--shapio-spec=file:${shapioTgz}`,
      `--database-url=${databaseUrl(databases[1])}`,
    ],
    work,
  );
  const project = join(work, 'my-cms');
  // The example project extension (hook, custom route, service, job) replaces the template's empty config.
  cpSync(join(root, 'examples/extension/shapio.config.ts'), join(project, 'shapio.config.ts'));
  cpSync(join(root, 'examples/extension/extensions'), join(project, 'extensions'), { recursive: true });
  run('npx', ['shapio', 'extensions', 'check'], project);
  await startAndProbe('create-shapio + npm run start', 'npm', ['run', 'start'], project, {}, async (url) => {
    // Served by the extension (an admin-only route): 401 without credentials, where an unknown path is 404.
    const stats = await fetch(`${url}/api/ext/example/stats`);
    const missing = await fetch(`${url}/api/ext/nothing-here`);
    if (stats.status !== 401 || missing.status !== 404) {
      throw new Error(`custom route: /api/ext/example/stats ${stats.status}, unknown ${missing.status}`);
    }
    log('create-shapio + npm run start: custom route /api/ext/example/stats served');
  });

  // 4. create-shapio --site: the starters, packed from examples/, as standalone projects
  for (const starter of SITE_STARTERS) {
    checkSiteStarter(createTgz, work, starter);
  }

  // 5. the scaffolded Next.js starter builds against the project from step 2, started again
  run('npx', ['shapio', 'admin', 'create', '--email', SITE_ADMIN_EMAIL], project, {
    SHAPIO_ADMIN_PASSWORD: SITE_ADMIN_PASSWORD,
  });
  await startAndProbe(
    'create-shapio --site next + npm run build',
    'npm',
    ['run', 'start'],
    project,
    // The seed uploads media through grant URLs built from PUBLIC_URL, so it must be this server's address;
    // the allowlist lets it create the starter's revalidation webhook to localhost.
    (url) => ({ PUBLIC_URL: url, OUTBOUND_PRIVATE_NETWORK_ALLOWLIST: '127.0.0.1/32,::1/128' }),
    async (url) => buildNextStarter(siteTarballs, url),
  );
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`[smoke] FAILED: ${error instanceof Error ? error.stack : String(error)}\n`);
} finally {
  for (const name of databases) {
    await admin(`drop database if exists ${pg.escapeIdentifier(name)} with (force)`).catch(() => {});
  }
  rmSync(work, { recursive: true, force: true });
}
if (process.exitCode !== 1) {
  log('PASSED');
}
