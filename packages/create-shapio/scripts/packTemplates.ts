import { resolve } from 'node:path';
import { packTemplates } from '../src/pack/index.js';

/** `build` / `prepack`: writes templates/ from the repository's examples/ (see src/pack/index.ts). */
const packageDir = resolve(import.meta.dirname, '..');
const counts = packTemplates({
  repoRoot: resolve(packageDir, '../..'),
  outDir: resolve(packageDir, 'templates'),
});
for (const [starter, files] of Object.entries(counts)) {
  process.stdout.write(`create-shapio: packed the ${starter} starter (${files} files)\n`);
}
