import { createHash } from 'node:crypto';
import {
  LOCK_FILE_FORMAT_VERSION,
  LOCK_FILE_PATH,
  schemaFilePath,
  scopeOfSchemaFilePath,
  serializeDefinition,
  serializeLockFile,
  type LockFile,
} from '@shapio/schema';
import type { SchemaSnapshot } from '../../schema/snapshot.js';
import { getSiteRef } from '../../services/sites.js';
import { runCheck, toTestResult } from '../testResult.js';
import type { DeploymentProviderAdapter, ProviderContext, RunContext } from '../types.js';
import { describeFailure, requestJson } from './http.js';

/**
 * Optional git write-back (GitHub): after schema changes in production, the canonical schema files (the same
 * files `shapio schema pull` writes, plus its lock file) are committed to a branch, or proposed on a pull
 * request from `shapio/schema-sync`. Git mirrors production; it is never a lock. Bursts of activations
 * coalesce into one run that writes the latest state. Uses the Git data API: ref → commit → tree, a new
 * tree on top of the base tree (deleted definitions removed), a commit, then the ref update or the PR.
 */
const SYNC_BRANCH = 'shapio/schema-sync';
const API_VERSION = '2022-11-28';

type GitTreeEntry = { path: string; mode: string; type: string; sha: string };

const settingsOf = (context: ProviderContext) => ({
  owner: context.connection.settings.owner ?? '',
  repo: context.connection.settings.repo ?? '',
  branch: context.connection.settings.branch ?? 'main',
  mode: context.connection.settings.mode === 'pull_request' ? 'pull_request' : 'commit',
  directory: (context.connection.settings.directory ?? 'schema').replace(/^\/+|\/+$/g, '') || 'schema',
});

const github = async <T>(
  context: ProviderContext,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> => {
  const { owner, repo } = settingsOf(context);
  const response = await requestJson(context.runtime, {
    url: `${context.runtime.config.githubApiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`,
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${context.connection.secrets.token ?? ''}`,
      'x-github-api-version': API_VERSION,
    },
    ...(body !== undefined ? { body } : {}),
    policy: context.trustedPolicy,
    signal: context.signal,
  });
  if (!response.ok) {
    const message = (response.json as { message?: string } | undefined)?.message;
    throw Object.assign(new Error(`GitHub ${method} ${path}: ${describeFailure(response, message)}`), {
      status: response.status,
    });
  }
  return { status: response.status, data: response.json as T };
};

/** Git's blob ID for a file's content, to skip files that did not change. */
export const gitBlobSha = (content: string): string => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};

/**
 * The files `shapio schema pull --site <siteKey>` would write for a site's view, keyed by repository path:
 * shared definitions in `models/` and `components/`, the site's own under `sites/<siteKey>/` (plan
 * site-schema), and a format-2 lock covering that site.
 */
export const schemaFilesOf = (
  snapshot: SchemaSnapshot,
  directory: string,
  siteKey: string,
): Map<string, string> => {
  const files = new Map<string, string>();
  const lock: LockFile = {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    schemaVersion: snapshot.version,
    sites: [siteKey],
    definitions: {},
  };
  for (const active of snapshot.definitions) {
    const { definition } = active;
    const site = active.siteId === null ? null : siteKey;
    files.set(`${directory}/${schemaFilePath(definition, site)}`, serializeDefinition(definition));
    lock.definitions[definition.id] = {
      kind: definition.kind,
      apiKey: definition.apiKey,
      version: active.version,
      hash: active.hash,
      site,
    };
  }
  files.set(LOCK_FILE_PATH, serializeLockFile(lock));
  return files;
};

/** A schema file this site's write-back owns: shared ones and its own folder, never another site's. */
const isSchemaFile = (path: string, directory: string, siteKey: string) => {
  if (!path.startsWith(`${directory}/`)) {
    return false;
  }
  const scope = scopeOfSchemaFilePath(path.slice(directory.length + 1));
  return scope !== undefined && (scope.site === null || scope.site === siteKey);
};

const treeChanges = (
  existing: readonly GitTreeEntry[],
  desired: ReadonlyMap<string, string>,
  directory: string,
  siteKey: string,
) => {
  const current = new Map(
    existing.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.sha]),
  );
  const changes: Array<{ path: string; mode: '100644'; type: 'blob'; content?: string; sha?: null }> = [];
  for (const [path, content] of desired) {
    if (current.get(path) !== gitBlobSha(content)) {
      changes.push({ path, mode: '100644', type: 'blob', content });
    }
  }
  for (const path of current.keys()) {
    if (isSchemaFile(path, directory, siteKey) && !desired.has(path)) {
      changes.push({ path, mode: '100644', type: 'blob', sha: null });
    }
  }
  return changes;
};

const ensurePullRequest = async (context: ProviderContext, commitSha: string, title: string) => {
  const { owner, branch } = settingsOf(context);
  const ref = `heads/${SYNC_BRANCH}`;
  try {
    await github(context, 'PATCH', `/git/refs/${ref}`, { sha: commitSha, force: true });
  } catch (error) {
    if ((error as { status?: number }).status !== 422 && (error as { status?: number }).status !== 404) {
      throw error;
    }
    await github(context, 'POST', '/git/refs', { ref: `refs/${ref}`, sha: commitSha });
  }
  const open = await github<Array<{ html_url: string; number: number }>>(
    context,
    'GET',
    `/pulls?state=open&head=${encodeURIComponent(`${owner}:${SYNC_BRANCH}`)}&base=${encodeURIComponent(branch)}`,
  );
  const existing = open.data[0];
  if (existing) {
    return { url: existing.html_url, message: `Updated pull request #${existing.number}` };
  }
  const created = await github<{ html_url: string; number: number }>(context, 'POST', '/pulls', {
    title,
    head: SYNC_BRANCH,
    base: branch,
    body: 'Schema changes made in Shapio (live in production). Merge to keep the schema files in git up to date.',
  });
  return { url: created.data.html_url, message: `Opened pull request #${created.data.number}` };
};

const writeBack = async (context: RunContext) => {
  const { branch, mode, directory } = settingsOf(context);
  // The connection's site: shared definitions and the site's own (plan site-schema).
  const site = await getSiteRef(context.connection.row.site_id, context.environment.runtime.db);
  const snapshot = (await context.environment.registry.getSnapshot()).forSite(site.id);
  const head = await github<{ object: { sha: string } }>(
    context,
    'GET',
    `/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const headSha = head.data.object.sha;
  const commit = await github<{ tree: { sha: string } }>(context, 'GET', `/git/commits/${headSha}`);
  const tree = await github<{ tree: GitTreeEntry[] }>(
    context,
    'GET',
    `/git/trees/${commit.data.tree.sha}?recursive=1`,
  );
  const changes = treeChanges(
    tree.data.tree,
    schemaFilesOf(snapshot, directory, site.key),
    directory,
    site.key,
  );
  if (changes.length === 0) {
    return {
      status: 'deployed' as const,
      message: `Already up to date on ${branch} (schema version ${snapshot.version})`,
    };
  }
  const title = `Shapio schema version ${snapshot.version}`;
  const newTree = await github<{ sha: string }>(context, 'POST', '/git/trees', {
    base_tree: commit.data.tree.sha,
    tree: changes,
  });
  const created = await github<{ sha: string; html_url: string }>(context, 'POST', '/git/commits', {
    message: `${title}\n\nCommitted by Shapio after a schema change in production.`,
    tree: newTree.data.sha,
    parents: [headSha],
  });
  if (mode === 'pull_request') {
    const pr = await ensurePullRequest(context, created.data.sha, title);
    return {
      status: 'deployed' as const,
      providerRef: created.data.sha,
      logUrl: pr.url,
      message: pr.message,
    };
  }
  // Not forced: if someone pushed meanwhile GitHub refuses, and the job retries on the new head.
  await github(context, 'PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, {
    sha: created.data.sha,
    force: false,
  });
  return {
    status: 'deployed' as const,
    providerRef: created.data.sha,
    logUrl: created.data.html_url,
    message: `Committed ${changes.length} file(s) to ${branch}`,
  };
};

export const githubWriteBackProvider: DeploymentProviderAdapter = {
  id: 'github',
  settings: [
    { name: 'owner', required: true, pattern: /^[A-Za-z0-9-]{1,39}$/ },
    { name: 'repo', required: true, pattern: /^[A-Za-z0-9._-]{1,100}$/ },
    { name: 'branch', required: true, pattern: /^[^\s~^:?*[\\]{1,250}$/, defaultValue: 'main' },
    { name: 'mode', required: true, pattern: /^(commit|pull_request)$/, defaultValue: 'commit' },
    { name: 'directory', required: false, pattern: /^[A-Za-z0-9._/-]{1,200}$/, defaultValue: 'schema' },
  ],
  secrets: [{ name: 'token', required: true }],
  reportsCompletion: true,
  destinations: () => [],
  trigger: writeBack,
  test: async (context) => {
    const { owner, repo, branch } = settingsOf(context);
    return toTestResult([
      await runCheck('repository', async () => {
        const { data } = await github<{ full_name?: string; permissions?: { push?: boolean } }>(
          context,
          'GET',
          '',
        );
        if (data.permissions && data.permissions.push === false) {
          throw new Error(`The token can read ${owner}/${repo} but cannot push to it`);
        }
        return `The token can write to ${data.full_name ?? `${owner}/${repo}`}`;
      }),
      await runCheck('branch', async () => {
        await github(context, 'GET', `/branches/${encodeURIComponent(branch)}`);
        return `Branch ${branch} exists`;
      }),
    ]);
  },
};
