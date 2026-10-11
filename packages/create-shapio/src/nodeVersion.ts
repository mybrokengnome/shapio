// Duplicates apps/api/src/helpers/nodeVersion.ts on purpose: create-shapio has no runtime dependencies.
/** The oldest Node.js major version Shapio runs on (`engines.node` in package.json). */
export const MIN_NODE_MAJOR = 24;

/** True when `version` (as `process.versions.node` gives it, e.g. `24.1.0`) is new enough. */
export const isSupportedNode = (version: string): boolean =>
  Number.parseInt(version.split('.')[0] ?? '', 10) >= MIN_NODE_MAJOR;

/** The one-line refusal shown when Node.js is too old, or undefined when `version` is supported. */
export const unsupportedNodeMessage = (version: string): string | undefined =>
  isSupportedNode(version)
    ? undefined
    : `create-shapio needs Node.js ${MIN_NODE_MAJOR} or newer, and this is v${version}. ` +
      'Install a newer Node.js from https://nodejs.org/ or with your version manager, then run the command again.';
