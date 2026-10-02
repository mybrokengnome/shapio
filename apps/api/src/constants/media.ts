/** Media library limits and timings (package G). Upload size and allowed types are configuration. */

/** Shapio's route for stored objects: public ones at a stable URL, private ones with a signature. */
export const MEDIA_FILE_ROUTE_PREFIX = '/api/media/f/';
/** Where the local driver receives upload bytes (`/api/media/uploads/:grantId`). */
export const MEDIA_UPLOAD_ROUTE_PREFIX = '/api/media/uploads/';

/** How long a signed URL for a private asset works. */
export const MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60;
/** How long an upload grant accepts bytes. */
export const MEDIA_UPLOAD_GRANT_TTL_SECONDS = 15 * 60;
/** How long after a grant expires an uploaded-but-unconfirmed object is kept before it is deleted. */
export const MEDIA_UPLOAD_CONFIRM_GRACE_SECONDS = 60 * 60;
/** Bytes read from the start of an upload to detect its type. */
export const MEDIA_SNIFF_SAMPLE_BYTES = 16 * 1024;

export const MEDIA_PROCESS_JOB = 'media.process';
export const MEDIA_PURGE_JOB = 'media.purge';
export const MEDIA_RELOCATE_JOB = 'media.relocate';
export const MEDIA_GRANT_EXPIRE_JOB = 'media.grant.expire';
export const MEDIA_JOB_MAX_ATTEMPTS = 5;

/** Outbox event types (webhook catalogue `media.*`, package H). */
export const MEDIA_EVENTS = {
  created: 'media.created',
  updated: 'media.updated',
  deleted: 'media.deleted',
} as const;
