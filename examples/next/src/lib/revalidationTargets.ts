import { articlePath, articlesPath, pagePath } from './site';

/**
 * What a set of Shapio changes means for this site's pages: the arguments for Next's `revalidatePath`. Pure,
 * so the mapping is unit-tested; src/lib/revalidation.ts feeds it from the snapshot diff.
 */
export type RevalidationTarget = { path: string; type?: 'page' | 'layout' };

/** One entry's change in one locale, with its slugs (where it was and where it is; empty for models without). */
export type ChangedEntry = { modelKey: string; locale: string; slugs: readonly string[] };

/** Every page: the root layout holds them all (the siteSettings singleton is on each, in its header and footer). */
export const EVERY_PAGE: RevalidationTarget = { path: '/', type: 'layout' };
/** Every article page in every locale (each shows its author). */
const EVERY_ARTICLE: RevalidationTarget = { path: '/[locale]/articles/[slug]', type: 'page' };

/** The webhook events that can change what the site shows; anything else is acknowledged and ignored. */
export const REVALIDATING_EVENTS: readonly string[] = [
  'entry.published',
  'entry.unpublished',
  'entry.deleted',
  'change_set.shipped',
  'schema.activated',
  'schema.deleted',
  // "Send test" in Shapio's webhook screen: runs a real (usually empty) revalidation.
  'webhook.test',
];

const targetsOf = ({ modelKey, locale, slugs }: ChangedEntry): RevalidationTarget[] => {
  switch (modelKey) {
    case 'page':
      return slugs.map((slug) => ({ path: pagePath(locale, slug) }));
    case 'article':
      return [{ path: articlesPath(locale) }, ...slugs.map((slug) => ({ path: articlePath(locale, slug) }))];
    case 'author':
      return [{ path: articlesPath(locale) }, EVERY_ARTICLE];
    case 'siteSettings':
      return [EVERY_PAGE];
    default:
      // A model this site does not render.
      return [];
  }
};

const keyOf = (target: RevalidationTarget) => `${target.type ?? ''} ${target.path}`;

/**
 * The pages to revalidate, without duplicates. A schema change between the two snapshots (fields added,
 * converted or removed without a republish) or a change to every page collapses to revalidating everything.
 */
export const revalidationTargets = (
  entries: readonly ChangedEntry[],
  schemaChanged: boolean,
): RevalidationTarget[] => {
  if (schemaChanged) {
    return [EVERY_PAGE];
  }
  const targets = new Map<string, RevalidationTarget>();
  for (const target of entries.flatMap(targetsOf)) {
    targets.set(keyOf(target), target);
  }
  if (targets.has(keyOf(EVERY_PAGE))) {
    return [EVERY_PAGE];
  }
  return [...targets.values()].sort((a, b) => a.path.localeCompare(b.path));
};
