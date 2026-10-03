import { createHmac } from 'node:crypto';
import { parseArgs } from 'node:util';

/**
 * `npm run smoke`, after `npm run seed`, `npm run build` and starting the built site (`npm run start` or
 * `npm run preview`): fetches the site's pages over HTTP and checks the seeded content in English and French,
 * the site settings singleton, rich text, media variants and the author, that the draft article is not
 * served, that content carries the visual-editing attributes (@shapio/visual's `shapioAttr`), and that the
 * preview page is served with a `frame-ancestors` policy. The same checks run against every starter, so all
 * three render the same blog.
 *
 * `--url` is the running site's origin (default: SMOKE_URL, then http://localhost:4321). `--revalidate` (the
 * Next.js starter) also checks its on-demand revalidation route: an unsigned POST to /api/revalidate is refused,
 * and an event signed with SHAPIO_WEBHOOK_SECRET is answered 200 with the paths it revalidated.
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
      ['data-shapio-entry="', 'visual-editing entry attribute'],
      ['data-shapio-path="title"', 'visual-editing attribute on the title'],
      ['data-shapio-path="body"', 'visual-editing attribute on the body'],
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

const REVALIDATE_PATH = '/api/revalidate/';

const postEvent = (origin: string, body: string, headers: Record<string, string>) =>
  fetch(new URL(REVALIDATE_PATH, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

/** Signed like Shapio's webhooks: `v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`. */
const signatureHeaders = (secret: string, body: string) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { 'x-shapio-timestamp': timestamp, 'x-shapio-signature': `v1=${signature}` };
};

const checkRevalidation = async (origin: string) => {
  const secret = process.env.SHAPIO_WEBHOOK_SECRET;
  if (!secret) {
    check(
      false,
      `${REVALIDATE_PATH}: SHAPIO_WEBHOOK_SECRET is set (the seed writes it with --revalidate-path)`,
    );
    return;
  }
  const body = JSON.stringify({
    id: `smoke-${Date.now()}`,
    type: 'entry.published',
    createdAt: new Date().toISOString(),
    site: null,
    data: { modelKey: 'article', entryId: 'smoke', locale: 'en' },
  });
  const unsigned = await postEvent(origin, body, {});
  check(
    unsigned.status === 401,
    `${REVALIDATE_PATH}: an unsigned event is refused (HTTP ${unsigned.status})`,
  );
  const response = await postEvent(origin, body, signatureHeaders(secret, body));
  const text = await response.text();
  check(response.status === 200, `${REVALIDATE_PATH}: a signed event is accepted (HTTP ${response.status})`);
  let result: { revalidated?: unknown; skipped?: unknown; from?: unknown; to?: unknown } = {};
  try {
    result = JSON.parse(text) as typeof result;
  } catch {
    // Reported by the check below.
  }
  const listed = Array.isArray(result.revalidated) || typeof result.skipped === 'string';
  check(listed, `${REVALIDATE_PATH}: the answer lists the revalidated paths: ${text}`);
};

const main = async () => {
  const { values } = parseArgs({
    options: { url: { type: 'string' }, revalidate: { type: 'boolean', default: false } },
  });
  const origin = values.url ?? process.env.SMOKE_URL ?? 'http://localhost:4321';
  for (const page of PAGES) {
    const { status, html } = await fetchPage(origin, page.path);
    check(status === 200, `${page.path}: HTTP ${status}`);
    for (const [needle, label] of page.expect) {
      check(html.includes(needle), `${page.path}: ${label}`);
    }
  }
  const preview = await fetch(new URL('/preview/', origin));
  check(preview.status === 200, `/preview/: HTTP ${preview.status}`);
  check(
    /frame-ancestors/.test(preview.headers.get('content-security-policy') ?? ''),
    '/preview/: frame-ancestors policy (only the site and Shapio may frame it)',
  );
  const list = await fetchPage(origin, '/en/articles/');
  check(!list.html.includes(DRAFT_TITLE), 'the unpublished draft is not listed');
  const draft = await fetchPage(origin, '/en/articles/winter-projects/');
  check(draft.status === 404, `the unpublished draft is not served (HTTP ${draft.status})`);
  if (values.revalidate) {
    await checkRevalidation(origin);
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed against ${origin}`);
  }
  process.stdout.write(`Smoke test passed against ${origin}.\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`smoke: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
