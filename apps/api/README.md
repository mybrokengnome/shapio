<p align="center">
  <img src="https://raw.githubusercontent.com/mybrokengnome/shapio/main/brand/shapio-logo.svg" alt="Shapio" width="280">
</p>

<p align="center">
  <strong>The headless CMS you can change while it's live.</strong><br>
  Add a field in production. No rebuild, no restart, no deploy.
</p>

![The Shapio admin, editing a blog post](https://raw.githubusercontent.com/mybrokengnome/shapio/main/.github/readme/hero.png)

`@shapio/cms` is the Shapio server and its `shapio` CLI. Start a project with:

```sh
npx create-shapio@latest my-cms --database-url sqlite:./shapio.db
cd my-cms
npm run start
```

Then open `http://localhost:4300/admin/` and create your account. The
[repository](https://github.com/mybrokengnome/shapio) has the full tour and the
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
