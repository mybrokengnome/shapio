// prepack: put the prebuilt admin SPA inside the published `shapio` package (dist/admin).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(apiRoot, '../admin/dist');
const target = resolve(apiRoot, 'dist/admin');

if (!existsSync(resolve(source, 'index.html'))) {
  process.stderr.write(`copyAdmin: ${source}/index.html not found; build @shapio/admin first\n`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
process.stdout.write(`copyAdmin: copied admin build to ${target}\n`);
