/**
 * What a dynamic page renders. A build renders what getStaticPaths handed over as props (every page at the
 * build's one snapshot). `astro dev` keeps getStaticPaths results until it restarts, so there the page reads
 * its entry from Shapio when it renders, from `Astro.params`: a publish shows on reload, and an entry that is
 * gone (unpublished or deleted) is undefined, which the page answers with a 404.
 */
type RenderTimeSource<T> = {
  /** True under `astro dev`. */
  dev: boolean;
  /** What getStaticPaths handed over. */
  props: T | undefined;
  /** Reads the entry now; undefined when it is not published. */
  read: () => Promise<T | undefined>;
};

export const renderTimeEntry = async <T>({
  dev,
  props,
  read,
}: RenderTimeSource<T>): Promise<T | undefined> => (dev ? read() : props);

/** The entry with this slug, if any. */
export const findBySlug = <T extends { slug: string }>(entries: readonly T[], slug: string): T | undefined =>
  entries.find((entry) => entry.slug === slug);
