import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

/** What the CLI needs from a bundle's records (the server validates the whole bundle). */
export type ManifestAsset = {
  type: 'mediaAsset';
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  storageKey: string;
};

export type EndRecord = { type: 'end'; counts: Record<string, number> };

/** Media assets (the manifest) and the end record of a bundle stream. */
export const scanBundle = async (input: Readable) => {
  const assets: ManifestAsset[] = [];
  let end: EndRecord | undefined;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.includes('"type":"mediaAsset"') && !line.includes('"type":"end"')) {
      continue;
    }
    const record = JSON.parse(line) as { type: string };
    if (record.type === 'mediaAsset') {
      assets.push(record as ManifestAsset);
    } else if (record.type === 'end') {
      end = record as EndRecord;
    }
  }
  return { assets, end };
};

export const scanBundleFile = (path: string, range?: { start: number; end: number }) =>
  scanBundle(createReadStream(path, range ?? {}));

const COUNT_LABELS: ReadonlyArray<[string, string]> = [
  ['locale', 'locales'],
  ['definition', 'models and components'],
  ['appRole', 'app roles'],
  ['deliveryRole', 'delivery roles'],
  ['appUser', 'app users'],
  ['webhook', 'webhooks'],
  ['deploymentConnection', 'deployment connections'],
  ['mediaFolder', 'media folders'],
  ['mediaAsset', 'media assets'],
  ['entry', 'entries'],
  ['revision', 'revisions'],
];

/** The end record's counts as a sentence: `2 locales, 8 models and components, ...`. */
export const formatCounts = (counts: Record<string, number>) =>
  COUNT_LABELS.filter(([type]) => (counts[type] ?? 0) > 0)
    .map(([type, label]) => `${counts[type]} ${label}`)
    .join(', ');
