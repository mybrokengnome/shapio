import type { RefObject } from 'react';

type FrameProps = {
  frameRef: RefObject<HTMLIFrameElement | null>;
  src: string;
  title: string;
  onLoad: () => void;
};

/**
 * The site, framed. Its origin is never the admin's (checked before it renders), so `allow-same-origin` only
 * gives the site its own origin back (its fetches to Shapio need one); it can't reach the admin.
 */
export const Frame = ({ frameRef, src, title, onLoad }: FrameProps) => (
  <iframe
    ref={frameRef}
    src={src}
    title={title}
    onLoad={onLoad}
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    referrerPolicy="no-referrer"
    className="block size-full min-h-0 flex-1 border-0 bg-background"
  />
);
