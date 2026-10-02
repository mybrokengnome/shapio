export const isImage = (mimeType: string) => mimeType.startsWith('image/');

const MAX_KIND_LENGTH = 5;

/**
 * A short format code for a file ("PNG", "PDF"): the file name's extension, else the MIME subtype. A code,
 * not prose, so it is not translated.
 */
export const fileKindLabel = (filename: string, mimeType: string): string => {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1];
  if (extension && extension.length <= MAX_KIND_LENGTH) {
    return extension.toUpperCase();
  }
  const subtype = mimeType.split('/')[1]?.split(/[.+;-]/)[0] ?? '';
  return subtype.toUpperCase();
};
