import { parseSiteMessage, type SiteMessage } from '@shapio/visual';

type IncomingMessage = Pick<MessageEvent, 'source' | 'origin' | 'data'>;

/**
 * A message from the preview frame, or undefined. Only the framed window itself, on the preview URL's origin,
 * is heard: another window, frame or origin (the admin's own included) is ignored before the data is read.
 */
export const acceptSiteMessage = (
  event: IncomingMessage,
  frame: Window | null | undefined,
  previewOrigin: string | undefined,
): SiteMessage | undefined =>
  frame && previewOrigin && event.source === frame && event.origin === previewOrigin
    ? parseSiteMessage(event.data)
    : undefined;
