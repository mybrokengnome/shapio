import type { DeliveryOperation } from './operations';

/**
 * The request the builder describes, and the URL and code snippets it becomes. The token is never part
 * of the URL; snippets reference it as `$SHAPIO_TOKEN` so copying one never copies the secret.
 */
export type FilterRow = { id: string; key: string; value: string };

export type RequestDraft = {
  id: string;
  locale: string;
  snapshot: string;
  fields: string;
  populate: string;
  sort: string;
  page: string;
  pageSize: string;
  q: string;
  /** `filters[field][$op]=value` rows; `key` is the part inside `filters[…]`, e.g. `title][$contains`. */
  filters: FilterRow[];
};

export const EMPTY_DRAFT: RequestDraft = {
  id: '',
  locale: '',
  snapshot: '',
  fields: '',
  populate: '',
  sort: '',
  page: '',
  pageSize: '',
  q: '',
  filters: [],
};

const SCALAR_PARAMS = ['locale', 'snapshot', 'fields', 'populate', 'sort', 'page', 'pageSize', 'q'] as const;

/** `title][$contains` or `title.$contains` → `filters[title][$contains]`. */
export const filterParamName = (key: string): string => {
  const parts = key
    .replace(/^filters/, '')
    .split(/[[\].]+/)
    .filter((part) => part !== '');
  return `filters${parts.map((part) => `[${part}]`).join('')}`;
};

/** The path and query (relative to the API base) for a draft; `{id}` stays visible when not filled. */
export const requestPath = (operation: DeliveryOperation, draft: RequestDraft): string => {
  const path = operation.path.replace('{id}', draft.id.trim() ? encodeURIComponent(draft.id.trim()) : '{id}');
  const query = new URLSearchParams();
  for (const name of SCALAR_PARAMS) {
    const value = draft[name].trim();
    if (value && operation.parameters.some((parameter) => parameter.name === name)) {
      query.append(name, value);
    }
  }
  if (operation.list) {
    for (const row of draft.filters) {
      if (row.key.trim() && row.value !== '') {
        query.append(filterParamName(row.key.trim()), row.value);
      }
    }
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
};

export const isSendable = (operation: DeliveryOperation, draft: RequestDraft) =>
  !operation.byId || draft.id.trim() !== '';

const TOKEN_PLACEHOLDER = '$SHAPIO_TOKEN';

export const curlSnippet = (url: string, withToken: boolean): string =>
  [`curl '${url.replace(/'/g, "'\\''")}'`, `  -H 'accept: application/json'`]
    .concat(withToken ? [`  -H "authorization: Bearer ${TOKEN_PLACEHOLDER}"`] : [])
    .join(' \\\n');

export const fetchSnippet = (url: string, withToken: boolean): string => {
  const headers = withToken
    ? `{\n    accept: 'application/json',\n    authorization: \`Bearer \${process.env.SHAPIO_TOKEN}\`,\n  }`
    : `{ accept: 'application/json' }`;
  return `const response = await fetch(${JSON.stringify(url)}, {\n  headers: ${headers},\n});\nconst { data, meta } = await response.json();\n`;
};
