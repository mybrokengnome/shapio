import { resolve } from 'node:path';
import { renderCliReference } from './cliReference.js';
import { renderEnvironmentReference } from './environment.js';
import { renderRestReference } from './restReference.js';

/**
 * The generated pages of the documentation (documentation/reference/). `pnpm docs:reference` writes them;
 * `reference.test.ts` fails when a checked-in page differs from what its generator produces now.
 */
export const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');

export const REFERENCE_PAGES: ReadonlyArray<{ path: string; render: () => Promise<string> | string }> = [
  { path: 'documentation/reference/environment.md', render: () => renderEnvironmentReference() },
  { path: 'documentation/reference/cli.md', render: renderCliReference },
  { path: 'documentation/reference/rest-api.md', render: renderRestReference },
];
