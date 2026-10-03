import type { ConversionWarning } from './types.js';

/** What a warning code means, for the summary of a plan or map run. */
const WARNING_LABELS: Readonly<Record<string, string>> = {
  imageUnresolved: 'images left out of rich text (not imported)',
  unsafeLink: 'links kept as plain text (unsafe or relative address)',
  embedDropped: 'embeds dropped (iframes, video, forms)',
  invalidOutput: 'rich-text values imported as plain text',
  missingReference: 'references to entries that were not imported',
  missingMedia: 'references to media that were not imported',
  mediaTextNotSet: 'media whose alt text or caption could not be set',
  shortcodeKept: 'WordPress shortcodes kept as text',
  unsupportedBlock: 'Strapi blocks that have no rich-text equivalent',
};

const EXAMPLES = 3;

/** One line per warning code with a count and a few examples; empty when there were none. */
export const formatWarnings = (warnings: readonly ConversionWarning[]): string => {
  const byCode = new Map<string, string[]>();
  for (const warning of warnings) {
    byCode.set(warning.code, [...(byCode.get(warning.code) ?? []), warning.detail]);
  }
  return [...byCode]
    .map(([code, details]) => {
      const examples = [...new Set(details)].slice(0, EXAMPLES).join(', ');
      return `  ${details.length} ${WARNING_LABELS[code] ?? code}${examples ? ` (e.g. ${examples})` : ''}\n`;
    })
    .join('');
};
