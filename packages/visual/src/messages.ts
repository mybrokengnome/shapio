/**
 * The messages between a site in Shapio's preview frame and the admin around it. Every message carries the
 * protocol version; anything that does not parse is ignored. Who may send a message (the frame's window from
 * the preview origin, the parent from the Shapio origin) is checked by each side before parsing.
 */
export const VISUAL_PROTOCOL_VERSION = 1;
/** The query parameter the admin adds to a preview URL it frames (`?shapio-visual=1`). */
export const VISUAL_QUERY_PARAM = 'shapio-visual';

export type VisualReadyMessage = { type: 'shapio:ready'; v: typeof VISUAL_PROTOCOL_VERSION };
export type VisualFocusMessage = {
  type: 'shapio:focus';
  v: typeof VISUAL_PROTOCOL_VERSION;
  entryId: string;
  /** A JSON pointer of API IDs (`/title`, `/sections/2/heading`). */
  path: string;
  locale?: string;
};
export type VisualRefreshMessage = { type: 'shapio:refresh'; v: typeof VISUAL_PROTOCOL_VERSION };

/** What the site posts to the admin. */
export type SiteMessage = VisualReadyMessage | VisualFocusMessage;
/** What the admin posts to the site. */
export type AdminMessage = VisualRefreshMessage;

const MAX_PATH_LENGTH = 512;
const MAX_PATH_SEGMENTS = 32;
const SEGMENT = /^[A-Za-z0-9_~-]+$/;
const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE = /^[A-Za-z0-9-]{1,35}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `title`, `/title` or `sections/2/heading` → a JSON pointer (`/sections/2/heading`); undefined if malformed. */
export const normalizeFieldPath = (path: unknown): string | undefined => {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return undefined;
  }
  const segments = path.replace(/^\//, '').split('/');
  if (segments.length > MAX_PATH_SEGMENTS || !segments.every((segment) => SEGMENT.test(segment))) {
    return undefined;
  }
  return `/${segments.join('/')}`;
};

/** A message from the site, or undefined when the data is not one. */
export const parseSiteMessage = (data: unknown): SiteMessage | undefined => {
  if (!isRecord(data) || data.v !== VISUAL_PROTOCOL_VERSION) {
    return undefined;
  }
  if (data.type === 'shapio:ready') {
    return { type: 'shapio:ready', v: VISUAL_PROTOCOL_VERSION };
  }
  if (data.type !== 'shapio:focus') {
    return undefined;
  }
  const path = normalizeFieldPath(data.path);
  if (typeof data.entryId !== 'string' || !ENTRY_ID.test(data.entryId) || !path) {
    return undefined;
  }
  if (data.locale !== undefined && (typeof data.locale !== 'string' || !LOCALE.test(data.locale))) {
    return undefined;
  }
  return {
    type: 'shapio:focus',
    v: VISUAL_PROTOCOL_VERSION,
    entryId: data.entryId,
    path,
    ...(typeof data.locale === 'string' ? { locale: data.locale } : {}),
  };
};

/** A message from the admin, or undefined when the data is not one. */
export const parseAdminMessage = (data: unknown): AdminMessage | undefined =>
  isRecord(data) && data.v === VISUAL_PROTOCOL_VERSION && data.type === 'shapio:refresh'
    ? { type: 'shapio:refresh', v: VISUAL_PROTOCOL_VERSION }
    : undefined;
