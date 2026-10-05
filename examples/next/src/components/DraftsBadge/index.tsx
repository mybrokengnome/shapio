import type { Strings } from '../../lib/site';

type DraftsBadgeProps = { strings: Strings };

/** The corner badge of drafts mode (SHAPIO_DRAFTS=true): this server shows saved drafts, not the published site. */
export const DraftsBadge = ({ strings }: DraftsBadgeProps) => (
  <p className="drafts-badge" title={strings.draftsNote} data-shapio-drafts="">
    {strings.drafts}
  </p>
);
