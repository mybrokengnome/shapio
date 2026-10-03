/**
 * Reads the default `catalog:` map of pnpm-workspace.yaml (`name: version` lines indented under `catalog:`),
 * so a template's `catalog:` dependencies become the exact versions the repository builds the starters with.
 * Only that flat map is read; comments, blank lines and the rest of the file are ignored.
 */
export const parseCatalog = (workspaceYaml: string): Record<string, string> => {
  const catalog: Record<string, string> = {};
  let inCatalog = false;
  for (const line of workspaceYaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inCatalog = /^catalog:\s*(#.*)?$/.test(line);
      continue;
    }
    const entry = inCatalog
      ? /^\s+(['"]?)([^'"\s:#]+)\1\s*:\s*(['"]?)([^'"\s#]+)\3\s*(#.*)?$/.exec(line)
      : null;
    if (entry?.[2] && entry[4]) {
      catalog[entry[2]] = entry[4];
    }
  }
  return catalog;
};
