import { parseArgs } from 'node:util';

/**
 * `npm run smoke`, after `npm run seed`, `npm run build` and starting the built site (`npm run start` or
 * `npm run preview`): fetches the site's pages over HTTP and checks the seeded content in English and French,
 * the site settings singleton, rich text, media variants and the author, and that the draft article is not
 * served. The same checks run against every starter, so all three render the same blog.
 *
 * `--url` is the running site's origin (default: SMOKE_URL, then http://localhost:4321).
 */
const DRAFT_TITLE = 'Coming soon: our winter projects';
const ARTICLE = 'modelling-without-a-deploy';

type PageCheck = { path: string; expect: Array<[needle: string, label: string]> };

const PAGES: readonly PageCheck[] = [
  {
    path: '/en/',
    expect: [
      ['Content that changes as fast as your product', 'hero heading'],
      ['Static delivery', 'feature grid'],
      ['From the studio', 'gallery'],
      ['.webp', 'responsive image variants'],
      ['Northwind Studio', 'site name from the siteSettings singleton'],
      ['Built with Shapio', 'footer from the siteSettings singleton'],
    ],
  },
  {
    path: '/fr/',
    expect: [
      ['Un contenu qui évolue aussi vite que votre produit', 'hero heading'],
      ['lang="fr"', 'lang="fr"'],
      ['Studio Northwind', 'site name from the siteSettings singleton'],
    ],
  },
  {
    path: '/en/articles/',
    expect: [
      ['Modelling content without a deploy', 'article list'],
      ['Why our builds pin a snapshot', 'second article'],
    ],
  },
  {
    path: `/en/articles/${ARTICLE}/`,
    expect: [
      ['Modelling content without a deploy', 'title'],
      ['<table', 'rich-text table'],
      ['With Shapio', 'rich-text table cell'],
      ['Ada Moreau', 'populated author'],
    ],
  },
  { path: `/fr/articles/${ARTICLE}/`, expect: [['Modéliser du contenu sans déploiement', 'title']] },
  { path: '/fr/about/', expect: [['À propos du studio', 'page from the page collection']] },
  { path: '/en/colophon/', expect: [['pinned to one publication snapshot per build', 'singleton page']] },
];

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${message}\n`);
  if (!condition) {
    failures.push(message);
  }
};

const fetchPage = async (origin: string, path: string) => {
  const response = await fetch(new URL(path, origin));
  return { status: response.status, html: await response.text() };
};

const main = async () => {
  const { values } = parseArgs({ options: { url: { type: 'string' } } });
  const origin = values.url ?? process.env.SMOKE_URL ?? 'http://localhost:4321';
  for (const page of PAGES) {
    const { status, html } = await fetchPage(origin, page.path);
    check(status === 200, `${page.path}: HTTP ${status}`);
    for (const [needle, label] of page.expect) {
      check(html.includes(needle), `${page.path}: ${label}`);
    }
  }
  const list = await fetchPage(origin, '/en/articles/');
  check(!list.html.includes(DRAFT_TITLE), 'the unpublished draft is not listed');
  const draft = await fetchPage(origin, '/en/articles/winter-projects/');
  check(draft.status === 404, `the unpublished draft is not served (HTTP ${draft.status})`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed against ${origin}`);
  }
  process.stdout.write(`Smoke test passed against ${origin}.\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`smoke: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
