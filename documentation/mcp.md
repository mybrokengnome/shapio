# MCP server for coding agents

`@shapio/mcp` connects coding agents such as Claude Code, Cursor, Claude Desktop or any other MCP client to a Shapio instance over
the [Model Context Protocol](https://modelcontextprotocol.io). An agent can read your content types, model new
ones, write entries, upload media and open a change set for review.

**Agents propose, people ship.** Everything an agent writes is a draft: schema changes go into a change set as
schema drafts, and entries are saved as drafts and added to a change set. Nothing goes live until a person
reviews the set under **Develop → Changes** and ships it ([Change sets](change-sets.md)).

The server runs on your machine next to the agent (stdio), talks to Shapio's HTTP API with an API token, and
sends nothing anywhere else. Your instance needs no extra setup or configuration.

## 1. Create a role and a token for the agent

Give the agent its own role, so its token can do only what you want it to.

1. **Network → Roles → New role**, kind _Admin_, for example "Agent":
   - content, on every model: `read`, `create`, `update`;
   - `schema.create` (drafting new content types) and `schemaManage` on the models it may change;
   - `changes.manage` (creating and filling change sets);
   - `media.read` and `media.write` if it should upload media.

   Leave out `publish`, `delete` and **`changes.ship`**. Without `changes.ship` the server refuses to ship or
   schedule a change set with this token, whatever the agent tries.

2. **Settings → API tokens → New token**, bound to that role. Copy the token: it is shown once.

## 2. Connect your agent

`shapio mcp` prints the configuration for each client, with your instance's URL filled in (`--url`, else
`SHAPIO_URL`, else `PUBLIC_URL` + `BASE_PATH`):

```sh
npx @shapio/cms mcp                      # every client
npx @shapio/cms mcp --client claude-code
npx @shapio/cms mcp --client generic     # the stdio server definition, for any other MCP client
npx @shapio/cms mcp --site marketing     # a multi-site instance: work on the marketing site
```

Replace `<admin API token>` with the token from step 1.

**Claude Code** (in your project):

```sh
claude mcp add shapio --env SHAPIO_URL=https://cms.example.com --env "SHAPIO_TOKEN=shp_…" -- npx -y @shapio/mcp
```

**Cursor** (`.cursor/mcp.json`) and **Claude Desktop** (`claude_desktop_config.json`, then restart the app):

```json
{
  "mcpServers": {
    "shapio": {
      "command": "npx",
      "args": ["-y", "@shapio/mcp"],
      "env": { "SHAPIO_URL": "https://cms.example.com", "SHAPIO_TOKEN": "shp_…" }
    }
  }
}
```

**Any MCP client (stdio)**: `@shapio/mcp` is a stdio MCP server, so any client that can start one works. Give
it this command and environment (`npx @shapio/cms mcp --client generic` prints it as JSON):

| Setting        | Value                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Command        | `npx -y @shapio/mcp`                                                                                    |
| `SHAPIO_URL`   | Shapio's base URL.                                                                                      |
| `SHAPIO_TOKEN` | The admin API token from step 1.                                                                        |
| `SHAPIO_SITE`  | Optional: the site to work on, on an instance with several sites.                                       |
| Flags          | Optional, after the package name: `--allow-ship`, `--media-root <dir>` (see [Options](#options) below). |

```json
{
  "command": "npx",
  "args": ["-y", "@shapio/mcp", "--media-root", "/path/to/project/assets"],
  "env": { "SHAPIO_URL": "https://cms.example.com", "SHAPIO_TOKEN": "shp_…", "SHAPIO_SITE": "marketing" }
}
```

`SHAPIO_URL` is Shapio's base URL including any `BASE_PATH` (`https://example.com/cms`).

### Options

| Option               | What it does                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--media-root <dir>` | The only directory `media_upload` reads files from (symlinks are resolved). Default: the directory the server starts in.     |
| `--allow-ship`       | Also offers the `change_sets_ship` tool. This is a guard in the client only: the token's role must also hold `changes.ship`. |
| `--site <key>`       | The site to work on; overrides `SHAPIO_SITE`.                                                                                |

Keep `--allow-ship` off unless you want the agent to ship when you ask it to. Content an agent reads (an entry, a
web page) can contain instructions, and the agent might follow them. Leaving out the tool and leaving out
`changes.ship` from the role means it cannot ship even then.

On an instance with several sites, set `SHAPIO_SITE` (or pass `--site <key>`) to the site the agent works on;
every request then sends it as the `Shapio-Site` header. Without it the agent works on its token's site, else
the primary site. A site token cannot reach another site (`403 SITE_MISMATCH`); a network admin token works on
whichever site you name ([Sites](sites.md#api-tokens)). `shapio mcp --site
<key>` adds `SHAPIO_SITE` to the printed configuration.

## What the agent can do

Tools (names are stable):

| Tool                                                              | What it does                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `schema_list`, `schema_get`                                       | The site's content types (its own and the shared ones): API IDs, kinds, scope, fields; one definition in full with its version.   |
| `schema_draft`                                                    | Drafts a new or changed definition into a change set (a new set unless one is given). `shared: true` shares a new one.            |
| `change_sets_add_schema_draft`                                    | The same, into a given change set.                                                                                                |
| `content_query`, `content_get`                                    | Entries: drafts by default; `published: true` or `snapshot: N` reads what the delivery API serves. Filters, sort, locale, paging. |
| `content_create`, `content_update`                                | Saves drafts (never publishes). Updates send the version they read; a stale version is refused (`CONTENT_VERSION_CONFLICT`).      |
| `media_list`, `media_upload`                                      | The media library; uploads a file from the media root, optionally with alt text.                                                  |
| `preflight_run`                                                   | What publishing an entry would run into, without publishing.                                                                      |
| `change_sets_list`, `change_sets_create`, `change_sets_add_entry` | Change sets: list, create, propose publishing (or unpublishing) an entry locale.                                                  |
| `change_sets_review`                                              | The set and its review: field diffs, the schema plan (breaking, destructive), blocking issues, consumers of affected fields.      |
| `change_sets_ship`                                                | Only with `--allow-ship` and a role holding `changes.ship`.                                                                       |
| `snapshots_list`, `snapshots_changes`, `snapshots_restore`        | The publication ledger, what changed between two snapshots, and a restore proposed as an open change set.                         |
| `health_list`, `usage_fields`                                     | Content health findings (the Inbox), and which fields sites read, per token, before renaming or removing one.                     |

Definitions use the authored format of [schema files](schema-sync.md). IDs are optional: an existing type keeps
its IDs (matched by API ID), and relation targets and component references may be given as API IDs. A new
definition belongs to the agent's site; `shared: true` (on `schema_draft` and `change_sets_add_schema_draft`)
creates it shared with all sites instead, which needs schema permission on every site. An existing definition
keeps its scope: change it with [`shapio schema scope`](schema-sync.md#several-sites) or in the admin.

Resources: `shapio://schema/{apiKey}` (a definition of the site's view in the schema file format, with stable IDs) and
`shapio://docs/delivery-api` (the [delivery API guide](delivery-api.md)).

Prompts: **Model a content type for …** (`model_content_type`) and **Review change set N**
(`review_change_set`).

## Everything goes through the API

The MCP server is a thin client of Shapio's admin API (through `@shapio/client`), so the server
enforces every rule as it does for the admin: the token's role and field permissions, validation, version
guards, and the change set review. Every write is in the audit log under the token's name.
