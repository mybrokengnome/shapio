// Vendors the GraphiQL playground (package J) into vendor/graphiql: the playground is served by Shapio
// itself, never from a CDN (brief §8). Run with `node scripts/vendorGraphiql.mjs` to update the pinned
// versions below, then commit vendor/graphiql and update docs/licenses.md.
//
// GraphiQL 3 is the last major with a browser (UMD) build; it runs on React 18's UMD build. The admin's
// React 19 is unrelated: the playground is a separate page.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = [
  {
    spec: 'graphiql@3.9.0',
    files: {
      'graphiql.min.js': 'graphiql.min.js',
      'graphiql.min.css': 'graphiql.min.css',
      LICENSE: 'LICENSE.graphiql',
    },
  },
  {
    spec: 'react@18.3.1',
    files: { 'umd/react.production.min.js': 'react.production.min.js', LICENSE: 'LICENSE.react' },
  },
  {
    spec: 'react-dom@18.3.1',
    files: { 'umd/react-dom.production.min.js': 'react-dom.production.min.js', LICENSE: 'LICENSE.react-dom' },
  },
];

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../vendor/graphiql');
const work = mkdtempSync(join(tmpdir(), 'shapio-graphiql-'));
try {
  mkdirSync(target, { recursive: true });
  for (const { spec, files } of PACKAGES) {
    const tarball = execFileSync('npm', ['pack', spec, '--silent'], { cwd: work, encoding: 'utf8' }).trim();
    const unpacked = join(work, spec.replace(/[@/]/g, '_'));
    mkdirSync(unpacked);
    execFileSync('tar', ['-xzf', join(work, tarball), '-C', unpacked]);
    for (const [from, to] of Object.entries(files)) {
      cpSync(join(unpacked, 'package', from), join(target, to));
    }
    process.stdout.write(`vendored ${spec}\n`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
