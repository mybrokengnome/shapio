import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { REFERENCE_PAGES, REPOSITORY_ROOT } from '../src/reference/index.js';

/** `pnpm docs:reference`: regenerates the documentation's reference pages (environment, CLI, REST). */
for (const page of REFERENCE_PAGES) {
  const path = join(REPOSITORY_ROOT, page.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await page.render());
  process.stdout.write(`Wrote ${page.path}\n`);
}
process.exit(0);
