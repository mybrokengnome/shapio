import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connectAdmin } from '../../shared/scripts/lib/admin.js';
import { loadPreview, parsePreviewUrl } from '../src/lib/preview.js';

/**
 * `npm run smoke`, after `npm run seed` and `npm run build`: checks the built HTML (no browser
 * needed) and the preview path.
 * - dist/ has the seeded pages and articles in English and French, with media, rich text and the author;
 * - the build pinned one publication snapshot (dist/build.json);
 * - the unpublished draft is not on the site, and preview renders it with a preview token through the same
 *   code the /preview/ page runs in the browser.
 * Needs the .env the seed wrote, plus SHAPIO_ADMIN_EMAIL and SHAPIO_ADMIN_PASSWORD (preview tokens are issued to
 * signed-in admins).
 */
const DIST = resolve(import.meta.dirname, '..', 'dist');
const DRAFT_TITLE = 'Coming soon: our winter projects';

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${message}\n`);
  if (!condition) {
    failures.push(message);
  }
};

const html = (path: string) => readFile(join(DIST, path), 'utf8');

const allHtml = async (dir = DIST): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await allHtml(path)));
    } else if (entry.name.endsWith('.html')) {
      files.push(await readFile(path, 'utf8'));
    }
  }
  return files;
};

const checkBuild = async () => {
  const build = JSON.parse(await html('build.json')) as { snapshot: unknown };
  check(Number.isInteger(build.snapshot), `the build pinned publication snapshot ${String(build.snapshot)}`);
  const homeEn = await html('en/index.html');
  const homeFr = await html('fr/index.html');
  check(homeEn.includes('Content that changes as fast as your product'), 'EN home: hero heading');
  check(
    homeEn.includes('Northwind Studio') && homeEn.includes('Built with Shapio'),
    'EN home: site settings',
  );
  check(homeEn.includes('srcset=') && homeEn.includes('.webp'), 'EN home: responsive image variants');
  check(
    homeEn.includes('Static delivery') && homeEn.includes('From the studio'),
    'EN home: feature grid and gallery',
  );
  check(homeFr.includes('Un contenu qui évolue aussi vite que votre produit'), 'FR home: hero heading');
  check(homeFr.includes('<html lang="fr"'), 'FR home: lang="fr"');
  const articleEn = await html('en/articles/modelling-without-a-deploy/index.html');
  const articleFr = await html('fr/articles/modelling-without-a-deploy/index.html');
  check(articleEn.includes('Modelling content without a deploy'), 'EN article: title');
  check(articleEn.includes('<table>') && articleEn.includes('With Shapio'), 'EN article: rich-text table');
  check(articleEn.includes('Ada Moreau'), 'EN article: populated author');
  check(articleFr.includes('Modéliser du contenu sans déploiement'), 'FR article: title');
  check((await html('fr/about/index.html')).includes('À propos du studio'), 'FR about page');
  check(
    (await html('en/colophon/index.html')).includes('pinned to one publication snapshot per build'),
    'EN colophon: the siteSettings singleton page',
  );
  check(
    !(await allHtml()).some((page) => page.includes(DRAFT_TITLE)),
    'the unpublished draft is not on the site',
  );
  check((await html('preview/index.html')).includes('data-shapio-url'), 'the preview page is built');
};

const checkPreview = async () => {
  const admin = await connectAdmin(process.env);
  try {
    const drafts = await admin.client.admin.content.list('article', {
      filters: { slug: { $eq: 'winter-projects' } },
    });
    const entryId = drafts.items[0]?.id;
    check(entryId !== undefined, 'the draft article exists');
    if (!entryId) {
      return;
    }
    if (!admin.session) {
      throw new Error(
        'The preview check issues a preview token as a person: set SHAPIO_ADMIN_EMAIL and SHAPIO_ADMIN_PASSWORD',
      );
    }
    const { token } = await admin.session.request<{ token: string }>('/api/admin/preview/tokens', {
      method: 'POST',
      body: { modelKey: 'article', entryId, ttlSeconds: 600 },
    });
    // The URL Shapio opens from the connection's preview template, as the browser would see it.
    for (const [locale, expected] of [
      ['en', DRAFT_TITLE],
      ['fr', 'Bientôt : nos projets d’hiver'],
    ] as const) {
      const request = parsePreviewUrl(
        new URL(
          `http://localhost:4321/preview/?model=articles&id=${entryId}&locale=${locale}#token=${encodeURIComponent(token)}`,
        ),
      );
      const preview = request ? await loadPreview(admin.url, request) : undefined;
      check(preview?.html.includes(expected) === true, `preview renders the ${locale} draft`);
    }
  } finally {
    await admin.close();
  }
};

const main = async () => {
  await checkBuild();
  await checkPreview();
  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed`);
  }
  process.stdout.write('Smoke test passed.\n');
};

main().catch((error: unknown) => {
  process.stderr.write(`smoke: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
