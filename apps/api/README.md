# shapio

Self-hosted headless CMS: model content live, deliver it over REST and GraphQL. Start a project with
`npx create-shapio my-cms`; the full docs are in the repository's
[documentation](https://github.com/mybrokengnome/shapio/tree/main/documentation).

## Extensions

A project's `shapio.config.ts` (or `.mts`, `.js`, `.mjs`; `SHAPIO_CONFIG_PATH` to point elsewhere) adds code
to Shapio: lifecycle hooks, custom routes under `/api/ext/<prefix>`, shared services, background jobs and
custom field editors. Types and helpers come from `@shapio/cms/config`:

```ts
import { defineConfig } from '@shapio/cms/config';

export const config = defineConfig({
  hooks: { article: { beforePublish: ({ data, reject }) => void (data?.cover || reject('Needs a cover')) } },
  editors: [],
});
```

- `before*` hooks run inside the write's transaction; rejecting answers 422 `HOOK_REJECTED` and nothing is
  written. `after*` hooks run after commit as jobs, exactly once per change for their database work.
- Extensions are code: changing them needs a restart, never a rebuild. Content models change live.
- `npx shapio extensions check` validates the config (no database needed) and exits 1 on any problem.

The full guide is
[documentation/extensions.md](https://github.com/mybrokengnome/shapio/blob/main/documentation/extensions.md).
