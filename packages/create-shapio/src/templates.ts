export type TemplateInput = {
  projectName: string;
  shapioSpec: string;
  databaseUrl: string;
  sessionSecret: string;
};

const packageJson = ({ projectName, shapioSpec }: TemplateInput) =>
  `${JSON.stringify(
    {
      name: projectName,
      private: true,
      type: 'module',
      engines: { node: '>=24' },
      scripts: {
        start: 'shapio start',
        migrate: 'shapio migrate',
        worker: 'shapio worker',
        status: 'shapio status',
      },
      dependencies: { shapio: shapioSpec },
    },
    null,
    2,
  )}\n`;

const env = ({ databaseUrl, sessionSecret }: TemplateInput) =>
  [
    '# Shapio configuration. Every setting is an environment variable; `shapio` loads this file.',
    '# Real environment variables override values here.',
    'NODE_ENV=production',
    'HOST=127.0.0.1',
    'PORT=4300',
    'LOG_LEVEL=info',
    '',
    '# The origin people reach Shapio at; every absolute URL is built from it. Change it when you deploy.',
    'PUBLIC_URL=http://localhost:4300',
    '# BASE_PATH=/cms',
    '',
    '# HTTPS without a reverse proxy: set PUBLIC_URL=https://your.domain and PORT=443, and point these at your',
    '# certificate and key (PEM). Renewed files are picked up without a restart. HTTP_PORT=80 redirects to HTTPS.',
    '# TLS_CERT_FILE=/etc/shapio/tls/fullchain.pem',
    '# TLS_KEY_FILE=/etc/shapio/tls/privkey.pem',
    '# HTTP_PORT=80',
    '',
    '# PostgreSQL >= 16, or sqlite:<path> for a single-process install',
    `DATABASE_URL=${databaseUrl}`,
    'MIGRATE_ON_START=true',
    '',
    '# Signs preview links, private-media URLs and app-user tokens, and encrypts stored secrets.',
    '# Generated for this project; keep it secret, and back it up with the database.',
    `SESSION_SECRET=${sessionSecret}`,
    '',
    '# SETUP_REQUIRE_TOKEN=true  # require the logged one-time token for first-run setup (for installs exposed before setup)',
    '',
    '# inline: jobs run inside the server process. dedicated: run `npm run worker` as a second process.',
    'WORKER_MODE=inline',
    '',
    'MEDIA_PATH=./media',
    '',
  ].join('\n');

const shapioConfig =
  () => `// Project configuration for Shapio: code extensions (hooks, custom routes, services, jobs) and custom
// field editors. Content models are NOT configured here; they are created live in the admin UI and synced
// with \`shapio schema pull\` / \`shapio schema apply\`. This file is code: changing it, or anything in
// ./extensions, needs a restart (never a rebuild). Check it with \`npx shapio extensions check\`.
// TypeScript works as is (erasable syntax only: no enums or namespaces). Guide: documentation/extensions.md in Shapio's repository.
import { defineConfig } from 'shapio/config';

export const config = defineConfig({
  // Lifecycle hooks by model API ID ('*' = every model). before* hooks run inside the write's transaction
  // and may reject it (422 HOOK_REJECTED); after* hooks run after commit, as retried jobs.
  hooks: {
    // article: {
    //   beforePublish: ({ data, reject }) => {
    //     if (!data?.cover) reject('An article needs a cover image');
    //   },
    // },
  },

  // Custom React field editors: file names of ES modules built into ./extensions/editors/, e.g.
  // ['star-rating.js']. The admin loads them at runtime; installing one is a file copy plus a restart.
  editors: [],

  // Custom Fastify routes, mounted at /api/ext/<prefix>. Mutating routes must declare config.audit.
  // routes: [{ prefix: 'acme', plugin: async (app) => { app.get('/ping', async () => ({ ok: true })); } }],

  // Services constructed once at startup and shared by hooks, routes and jobs.
  // services: { stats: ({ services }) => ({ articles: () => services.content.count('article') }) },

  // Background jobs, registered as ext.<name>; enqueue with services.jobs.enqueue('<name>', payload).
  // jobs: { nightlyReport: async ({ services, logger }) => { logger.info('report'); } },
});
`;

const gitignore = () => `node_modules/
.env
media/*
!media/.gitkeep
`;

const pm2Ecosystem = ({ projectName }: TemplateInput) => `// PM2 process file: pm2 start ecosystem.config.cjs
// One instance in fork mode, the simplest setup. Several instances on one database are supported too: use the
// cluster variant below.
module.exports = {
  apps: [
    {
      name: ${JSON.stringify(projectName)},
      script: 'node_modules/shapio/dist/cli.js',
      args: 'start',
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 20000,
      env: { NODE_ENV: 'production' },
    },
    // Cluster variant (replace the app above): two processes sharing the port, each with its inline worker.
    // { name: ${JSON.stringify(projectName)}, script: 'node_modules/shapio/dist/cli.js', args: 'start', exec_mode: 'cluster', instances: 2, kill_timeout: 20000, env: { NODE_ENV: 'production' } },
  ],
};
`;

const readme = ({ projectName }: TemplateInput) =>
  `# ${projectName}

A [Shapio](https://github.com/mybrokengnome/shapio) project.

1. Set \`DATABASE_URL\` in \`.env\` to a PostgreSQL (>= 16) database, or to \`sqlite:<path>\` for a
   single-process install.
2. \`npm run start\`. Migrations run on start. The first boot logs where to create the owner account: open
   \`/admin/\`; the first person to complete Setup becomes the owner.
3. Under PM2: \`pm2 start ecosystem.config.cjs\`.

Content models are edited live in the admin; no restart is needed for modelling. Changing \`shapio.config.ts\`
or \`extensions/\` (code) needs a restart; \`npx shapio extensions check\` validates them.
`;

/** Files to write, relative to the project directory. */
export const renderTemplates = (input: TemplateInput): ReadonlyArray<[path: string, content: string]> => [
  ['package.json', packageJson(input)],
  ['.env', env(input)],
  [
    '.env.example',
    env({ ...input, databaseUrl: 'postgres://user:password@localhost:5432/shapio', sessionSecret: '' }),
  ],
  ['shapio.config.ts', shapioConfig()],
  ['.gitignore', gitignore()],
  ['ecosystem.config.cjs', pm2Ecosystem(input)],
  ['README.md', readme(input)],
  ['extensions/.gitkeep', ''],
  ['extensions/editors/.gitkeep', ''],
  ['media/.gitkeep', ''],
];
