import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gitBlobSha } from '../../src/deployments/providers/githubWriteBack.js';

/**
 * A local fake of the GitHub REST endpoints the write-back adapter uses (Git data API and pulls), with an
 * in-memory repository: refs, commits, trees (flat path → blob SHA) and blob contents.
 */
type Commit = { sha: string; tree: string; parents: string[]; message: string };

export type FakeGitHub = {
  url: string;
  owner: string;
  repo: string;
  token: string;
  refs: Map<string, string>;
  commits: Map<string, Commit>;
  /** Tree SHA → path → blob SHA. */
  trees: Map<string, Map<string, string>>;
  blobs: Map<string, string>;
  pulls: Array<{ number: number; head: string; base: string; title: string }>;
  /** The files on a branch, path → content. */
  filesOn: (branch: string) => Map<string, string>;
  close: () => Promise<void>;
};

const sha = (value: string) => createHash('sha1').update(value).digest('hex');

export const startFakeGitHub = async (): Promise<FakeGitHub> => {
  const fake = {
    owner: 'acme',
    repo: 'site',
    token: 'ghp_test',
    refs: new Map<string, string>(),
    commits: new Map<string, Commit>(),
    trees: new Map<string, Map<string, string>>(),
    blobs: new Map<string, string>(),
    pulls: [] as FakeGitHub['pulls'],
  } as FakeGitHub;

  const readme = '# Site\n';
  const readmeSha = gitBlobSha(readme);
  fake.blobs.set(readmeSha, readme);
  fake.trees.set('tree-0', new Map([['README.md', readmeSha]]));
  fake.commits.set('commit-0', { sha: 'commit-0', tree: 'tree-0', parents: [], message: 'init' });
  fake.refs.set('heads/main', 'commit-0');

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${fake.token}`) {
        send(401, { message: 'Bad credentials' });
        return;
      }
      const [path = '/', query = ''] = (req.url ?? '/').split('?');
      const base = `/repos/${fake.owner}/${fake.repo}`;
      const body =
        chunks.length > 0
          ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
          : {};
      const route = `${req.method ?? 'GET'} ${path.startsWith(base) ? path.slice(base.length) : path}`;
      let match: RegExpExecArray | null;

      if (route === 'GET ') {
        send(200, { full_name: `${fake.owner}/${fake.repo}`, permissions: { push: true } });
      } else if ((match = /^GET \/branches\/(.+)$/.exec(route))) {
        const name = decodeURIComponent(match[1] ?? '');
        if (fake.refs.has(`heads/${name}`)) {
          send(200, { name });
        } else {
          send(404, { message: 'Branch not found' });
        }
      } else if ((match = /^GET \/git\/ref\/(.+)$/.exec(route))) {
        const ref = decodeURIComponent(match[1] ?? '');
        const target = fake.refs.get(ref);
        if (target) {
          send(200, { ref: `refs/${ref}`, object: { sha: target, type: 'commit' } });
        } else {
          send(404, { message: 'Not Found' });
        }
      } else if ((match = /^GET \/git\/commits\/(.+)$/.exec(route))) {
        const commit = fake.commits.get(match[1] ?? '');
        if (commit) {
          send(200, {
            sha: commit.sha,
            tree: { sha: commit.tree },
            parents: commit.parents.map((parent) => ({ sha: parent })),
          });
        } else {
          send(404, { message: 'Not Found' });
        }
      } else if ((match = /^GET \/git\/trees\/(.+)$/.exec(route))) {
        const tree = fake.trees.get(match[1] ?? '');
        if (!tree || !query.includes('recursive=1')) {
          send(404, { message: 'Not Found' });
        } else {
          send(200, {
            sha: match[1],
            truncated: false,
            tree: [...tree].map(([entryPath, blob]) => ({
              path: entryPath,
              mode: '100644',
              type: 'blob',
              sha: blob,
            })),
          });
        }
      } else if (route === 'POST /git/trees') {
        const next = new Map(fake.trees.get(String(body.base_tree)) ?? []);
        for (const entry of body.tree as Array<{ path: string; content?: string; sha?: string | null }>) {
          if (entry.sha === null) {
            next.delete(entry.path);
          } else if (entry.content !== undefined) {
            const blob = gitBlobSha(entry.content);
            fake.blobs.set(blob, entry.content);
            next.set(entry.path, blob);
          }
        }
        const treeSha = sha(JSON.stringify([...next].sort()));
        fake.trees.set(treeSha, next);
        send(201, { sha: treeSha });
      } else if (route === 'POST /git/commits') {
        const commitSha = sha(`${String(body.tree)}:${JSON.stringify(body.parents)}:${String(body.message)}`);
        fake.commits.set(commitSha, {
          sha: commitSha,
          tree: String(body.tree),
          parents: body.parents as string[],
          message: String(body.message),
        });
        send(201, {
          sha: commitSha,
          html_url: `https://github.test/${fake.owner}/${fake.repo}/commit/${commitSha}`,
        });
      } else if ((match = /^PATCH \/git\/refs\/(.+)$/.exec(route))) {
        const ref = decodeURIComponent(match[1] ?? '');
        const current = fake.refs.get(ref);
        if (!current) {
          send(422, { message: 'Reference does not exist' });
          return;
        }
        const commit = fake.commits.get(String(body.sha));
        if (!body.force && !commit?.parents.includes(current)) {
          send(422, { message: 'Update is not a fast forward' });
          return;
        }
        fake.refs.set(ref, String(body.sha));
        send(200, { ref: `refs/${ref}`, object: { sha: body.sha } });
      } else if (route === 'POST /git/refs') {
        fake.refs.set(String(body.ref).replace(/^refs\//, ''), String(body.sha));
        send(201, { ref: body.ref, object: { sha: body.sha } });
      } else if (route === 'GET /pulls') {
        const params = new URLSearchParams(query);
        const head = params.get('head')?.split(':')[1];
        send(
          200,
          fake.pulls
            .filter((pull) => pull.head === head)
            .map((pull) => ({ number: pull.number, html_url: `https://github.test/pull/${pull.number}` })),
        );
      } else if (route === 'POST /pulls') {
        const pull = {
          number: fake.pulls.length + 1,
          head: String(body.head),
          base: String(body.base),
          title: String(body.title),
        };
        fake.pulls.push(pull);
        send(201, { number: pull.number, html_url: `https://github.test/pull/${pull.number}` });
      } else {
        send(404, { message: `No fake for ${route}` });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.url = `http://127.0.0.1:${port}`;
  fake.filesOn = (branch) => {
    const commit = fake.commits.get(fake.refs.get(`heads/${branch}`) ?? '');
    const tree = fake.trees.get(commit?.tree ?? '') ?? new Map<string, string>();
    return new Map([...tree].map(([path, blob]) => [path, fake.blobs.get(blob) ?? '']));
  };
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
};
