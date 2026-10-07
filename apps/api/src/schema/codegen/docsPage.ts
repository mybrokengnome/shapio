import { escapeHtml } from '@shapio/schema';

/**
 * A self-hosted, script-free HTML index of the OpenAPI document (build plan §3.10: no CDN). Endpoints are
 * grouped by model; schemas are shown as JSON. The raw document is linked for tools (Postman, codegen).
 */
type Operation = {
  summary?: string;
  operationId?: string;
  parameters?: Array<{ name: string; in: string; description?: string }>;
};
type Document = {
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
};

const STYLE = `
  :root { color-scheme: light dark; --bg: #faf9f6; --fg: #0f172a; --muted: #475569; --accent: #2563eb; --card: #ffffff; --border: #e2e8f0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --fg: #f1f5f9; --muted: #94a3b8; --accent: #a5b4fc; --card: #1e293b; --border: #334155; } }
  body { margin: 0; font-family: Manrope, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  main { max-width: 64rem; margin: 0 auto; padding: 2rem 1rem; }
  a { color: var(--accent); }
  section { background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem 1.25rem; margin: 1rem 0; }
  .op { display: flex; gap: 0.75rem; align-items: baseline; padding: 0.35rem 0; border-top: 1px solid var(--border); }
  .op:first-of-type { border-top: 0; }
  .method { font-weight: 700; min-width: 4.5rem; text-transform: uppercase; font-size: 0.8rem; color: var(--accent); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
  pre { overflow-x: auto; background: var(--bg); padding: 0.75rem; border-radius: 0.5rem; }
  .muted { color: var(--muted); }
  details summary { cursor: pointer; }
`;

/** Where GraphQL is served, when it is enabled (GRAPHQL_ENABLED). */
export type GraphqlDocsLinks = { endpoint: string; playground: string | undefined };

const GRAPHQL_TYPES: ReadonlyArray<[string, string]> = [
  ['string, text, slug, email, url, uid', 'String'],
  ['integer', 'Int53: a whole number in the safe-integer range (±2^53 − 1), sent as a JSON number'],
  ['number', 'Float'],
  ['decimal, biginteger', 'String (exact; the same canonical text as REST)'],
  ['date, datetime, time', 'String (ISO 8601; datetimes in UTC)'],
  ['boolean', 'Boolean'],
  ['enum', 'a per-field enum (a list when multiple)'],
  ['code', 'String (the language is in the field description, e.g. Code: html)'],
  ['json', 'JSON'],
  ['richtext', 'RichText { json html }'],
  ['media', 'Media (with MediaVariant and FocalPoint)'],
  ['relation', 'the target model type (a list for many)'],
  ['component, dynamic zone', 'the component type; a union of component types for zones'],
];

const renderGraphqlSection = (links: GraphqlDocsLinks): string => {
  const rows = GRAPHQL_TYPES.map(
    ([data, type]) => `<div class="op"><code>${escapeHtml(data)}</code><div>${escapeHtml(type)}</div></div>`,
  ).join('');
  const playground = links.playground
    ? ` · <a href="${escapeHtml(links.playground)}">Playground (GraphiQL)</a>`
    : '';
  return `<section><h2>GraphQL</h2>
<p>Endpoint <code>${escapeHtml(links.endpoint)}</code>${playground}. Same permissions, filters, page sizes and
locales as REST; the schema is regenerated whenever a model changes. Field data types map to:</p>${rows}</section>`;
};

export const renderDocsPage = (
  document: Document,
  openApiPath: string,
  graphql?: GraphqlDocsLinks,
): string => {
  const groups = new Map<string, string[]>();
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const tag = (operation as { tags?: string[] }).tags?.[0] ?? 'Other';
      const params = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'query')
        .map((parameter) => `<code>${escapeHtml(parameter.name)}</code>`)
        .join(' ');
      const row = `<div class="op"><span class="method">${escapeHtml(method)}</span><div><code>${escapeHtml(path)}</code><div class="muted">${escapeHtml(operation.summary ?? '')}${params ? ` · ${params}` : ''}</div></div></div>`;
      groups.set(tag, [...(groups.get(tag) ?? []), row]);
    }
  }
  const sections = [...groups]
    .map(([tag, rows]) => `<section><h2>${escapeHtml(tag)}</h2>${rows.join('')}</section>`)
    .join('');
  const schemas = Object.entries(document.components.schemas)
    .map(
      ([name, schema]) =>
        `<details><summary><code>${escapeHtml(name)}</code></summary><pre>${escapeHtml(JSON.stringify(schema, null, 2))}</pre></details>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.info.title)}</title><style>${STYLE}</style></head>
<body><main>
<h1>${escapeHtml(document.info.title)}</h1>
<p class="muted">Version ${escapeHtml(document.info.version)}. ${escapeHtml(document.info.description ?? '')}</p>
<p><a href="${escapeHtml(openApiPath)}">OpenAPI 3.1 document (JSON)</a></p>
${sections || '<section><p>No models yet.</p></section>'}
${graphql ? renderGraphqlSection(graphql) : ''}
<section><h2>Schemas</h2>${schemas}</section>
</main></body></html>`;
};
