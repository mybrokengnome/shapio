// Every workspace project in pnpm-lock.yaml must have its package.json copied into the image before
// `pnpm install --frozen-lockfile`, or the install fails with ERR_PNPM_OUTDATED_LOCKFILE. Run in CI's
// Docker job and locally with `node scripts/checkDockerfileManifests.mjs`.
import { readFileSync } from 'node:fs';

const lock = readFileSync('pnpm-lock.yaml', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');

const importers = new Set();
let inImporters = false;
for (const line of lock.split('\n')) {
  if (line === 'importers:') {
    inImporters = true;
    continue;
  }
  if (inImporters && /^\S/.test(line)) {
    inImporters = false;
    continue;
  }
  const match = inImporters ? /^ {2}(\S+):$/.exec(line) : null;
  if (match && match[1] !== '.') {
    importers.add(match[1]);
  }
}

const copied = new Set(
  [...dockerfile.matchAll(/^COPY (\S+)\/package\.json \1\/$/gm)].map((match) => match[1]),
);
const missing = [...importers].filter((importer) => !copied.has(importer));
if (missing.length > 0) {
  process.stderr.write(
    `Dockerfile is missing a manifest COPY line for: ${missing.join(', ')}\n` +
      `Add "COPY <project>/package.json <project>/" before "RUN pnpm install --frozen-lockfile".\n`,
  );
  process.exit(1);
}
process.stdout.write(`Dockerfile copies every workspace manifest (${importers.size} projects).\n`);
