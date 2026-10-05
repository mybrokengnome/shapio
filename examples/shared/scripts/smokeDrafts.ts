import { parseArgs } from 'node:util';
import { connectAdmin } from './lib/admin.js';

/**
 * `npm run smoke:drafts`, after `npm run seed` and starting the dev server with SHAPIO_DRAFTS=true (drafts mode,
 * which reads with the seed's SHAPIO_DEV_DELIVERY_TOKEN): checks that the site shows drafts, that every page
 * carries the "Drafts" badge, and that a change saved in Shapio (not published) shows on the next reload.
 * The saved change is put back afterwards. Needs SHAPIO_ADMIN_EMAIL and SHAPIO_ADMIN_PASSWORD (or SHAPIO_TOKEN,
 * an admin API token) to save the change, as the seed does.
 *
 * `--url` is the running dev server's origin (default: SMOKE_URL, then http://localhost:3000).
 */
const DRAFT_TITLE = 'Coming soon: our winter projects';
const ARTICLE = 'modelling-without-a-deploy';
const BADGE = 'data-shapio-drafts';
/** How long a saved draft may take to show: the dev server reads fresh, so this only absorbs a slow render. */
const SHOW_WITHIN_MS = 30_000;
const POLL_EVERY_MS = 250;

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

/** Reloads `path` until it contains `needle` (a real condition, not a fixed wait); false when it never does. */
const showsWithin = async (origin: string, path: string, needle: string): Promise<boolean> => {
  const deadline = Date.now() + SHOW_WITHIN_MS;
  while (Date.now() < deadline) {
    if ((await fetchPage(origin, path)).html.includes(needle)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
  }
  return false;
};

/** Saves (does not publish) the article's English title, and returns a function that puts the old one back. */
const saveTitle = async (client: Awaited<ReturnType<typeof connectAdmin>>['client'], title: string) => {
  const [item] = (
    await client.admin.content.list('article', { locale: 'en', filters: { slug: { $eq: ARTICLE } } })
  ).items;
  if (!item) {
    throw new Error(`The seeded article "${ARTICLE}" is missing; run npm run seed first`);
  }
  const entry = await client.admin.content.get('article', item.id, { locale: 'en' });
  const original = entry.data.title;
  // A save sends only the fields it changes.
  const saved = await client.admin.content.update('article', item.id, {
    locale: 'en',
    expectedVersion: entry.version,
    data: { title },
  });
  return async () => {
    await client.admin.content.update('article', item.id, {
      locale: 'en',
      expectedVersion: saved.version,
      data: { title: original },
    });
  };
};

const main = async () => {
  const { values } = parseArgs({ options: { url: { type: 'string' } } });
  const origin = values.url ?? process.env.SMOKE_URL ?? 'http://localhost:3000';

  const list = await fetchPage(origin, '/en/articles/');
  check(list.status === 200, `/en/articles/: HTTP ${list.status}`);
  check(list.html.includes(BADGE), '/en/articles/: the Drafts badge');
  check(list.html.includes(DRAFT_TITLE), 'the unpublished draft is listed (drafts mode)');
  const draft = await fetchPage(origin, '/en/articles/winter-projects/');
  check(
    draft.status === 200 && draft.html.includes(DRAFT_TITLE),
    `the unpublished draft is served (HTTP ${draft.status})`,
  );

  const admin = await connectAdmin(process.env);
  try {
    const marker = `Saved, not published ${Date.now()}`;
    const restore = await saveTitle(admin.client, marker);
    try {
      check(
        await showsWithin(origin, `/en/articles/${ARTICLE}/`, marker),
        'a change saved in Shapio shows on reload, without publishing',
      );
    } finally {
      await restore();
    }
  } finally {
    await admin.close();
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed against ${origin}`);
  }
  process.stdout.write(`Drafts smoke test passed against ${origin}.\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`smoke:drafts: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
