/**
 * Preview URLs from a connection's template, e.g. `https://preview.example.com/{path}?token={token}`.
 * Variables: {token}, {modelKey}, {entryId}, {locale} (URL-encoded) and {path} (`modelKey/entryId`, slashes
 * kept). `modelKey` is the model's route key, as in the delivery and preview APIs: the plural API ID of a
 * collection (`articles`), the API ID of a singleton. The token is a scoped, expiring preview token, never an
 * admin credential (brief §7).
 */
export type PreviewUrlVariables = {
  token: string;
  /** The route key (`routeKeyOf`). */
  modelKey: string;
  entryId: string;
  locale: string;
};

export const renderPreviewUrl = (template: string, variables: PreviewUrlVariables): string => {
  const values: Record<string, string> = {
    token: encodeURIComponent(variables.token),
    modelKey: encodeURIComponent(variables.modelKey),
    entryId: encodeURIComponent(variables.entryId),
    locale: encodeURIComponent(variables.locale),
    path: [variables.modelKey, variables.entryId].map(encodeURIComponent).join('/'),
  };
  const rendered = template.replace(
    /\{(token|modelKey|entryId|locale|path)\}/g,
    (_match, name: string) => values[name] ?? '',
  );
  const url = new URL(rendered);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Preview URLs must be http or https');
  }
  return url.toString();
};
