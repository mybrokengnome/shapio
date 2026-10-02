// PM2 process file for a project created with `npx create-shapio` (run from the project directory):
//   pm2 start ecosystem.config.cjs && pm2 save
// One instance in fork mode, the simplest setup. Several instances on one database are supported too (see
// "Several instances" in documentation/install-npm.md): use the cluster variant below. Settings come from the
// project's .env.
module.exports = {
  apps: [
    {
      name: 'shapio',
      script: 'node_modules/shapio/dist/cli.js',
      args: 'start',
      exec_mode: 'fork',
      instances: 1,
      // Longer than SHUTDOWN_TIMEOUT_MS so in-flight jobs can finish or be released.
      kill_timeout: 20000,
      env: { NODE_ENV: 'production' },
    },
    // Cluster variant (replace the app above): two API processes sharing the port, each with its inline worker.
    // { name: 'shapio', script: 'node_modules/shapio/dist/cli.js', args: 'start', exec_mode: 'cluster', instances: 2, kill_timeout: 20000, env: { NODE_ENV: 'production' } },
    // With WORKER_MODE=dedicated in .env, uncomment to run the job worker as its own process:
    // { name: 'shapio-worker', script: 'node_modules/shapio/dist/cli.js', args: 'worker', exec_mode: 'fork', instances: 1, kill_timeout: 20000 },
  ],
};
