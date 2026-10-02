/**
 * A Content-Disposition value that names the file safely: an ASCII fallback plus the RFC 5987 UTF-8 form,
 * so quotes, semicolons or line breaks in a filename can never inject header parameters.
 */
export const contentDisposition = (filename: string, type: 'inline' | 'attachment' = 'inline'): string => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

/** Types a browser only ever displays passively: opening one directly cannot run script. */
const PASSIVE_INLINE_TYPE =
  /^(image\/(png|jpeg|gif|webp|avif|bmp|tiff|x-icon|vnd\.microsoft\.icon)|video\/.+|audio\/.+)$/;

/**
 * Content-Disposition to store on an object in a bucket. Public objects can be served straight from the
 * bucket or a CDN, where Shapio's sandboxing headers are absent; anything that could run as a page there
 * (SVG, HTML, XML, PDF...) is stored as an attachment, so opening it downloads it. `<img>` tags still show
 * an SVG, since embedding ignores Content-Disposition.
 */
export const bucketContentDisposition = (contentType: string): string | undefined =>
  PASSIVE_INLINE_TYPE.test(contentType.toLowerCase()) ? undefined : 'attachment';
