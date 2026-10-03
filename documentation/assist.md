# Assist: editor help from your own model provider

Assist adds model-backed help to the editor: alt text for images, summaries, translations, rewrites,
content-type drafts from a description, and batch proposals for content-health findings. It uses a model
provider **you** configure: a hosted API with your own key, or a model running on your own machine (Ollama,
LM Studio, vLLM).

**Off by default.** Until you set `AI_PROVIDER`, assist is off, its endpoints don't exist (only `GET
/api/admin/assist/status`, which answers `{"enabled": false}`), and Shapio never contacts a model provider. A
test in Shapio's suite checks this on every build.

**Agents propose, people ship.** Every assist action returns a proposal for a person to review, or writes
drafts into a change set. Nothing is ever published by assist.

## Setup

Set these in the environment of the API (and of a dedicated `shapio worker`, if you run one, because
content-ops runs as a job). Changing them needs a restart. All of them are listed in the
[environment reference](reference/environment.md#assist-your-own-model-provider-off-unless-ai_provider-is-set).

| Variable            | Default                   |                                                                          |
| ------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `AI_PROVIDER`       | (unset: off)              | `anthropic`, `openai` or `openai-compatible`                             |
| `AI_MODEL`          |                           | Required. The model name your provider expects.                          |
| `AI_API_KEY`        |                           | Required for `anthropic` and `openai`. Optional for `openai-compatible`. |
| `AI_BASE_URL`       | the provider's public API | Required for `openai-compatible`. Includes the version path (`…/v1`).    |
| `AI_MAX_TOKENS`     | `8192`                    | Most tokens one answer may use.                                          |
| `AI_TIMEOUT_MS`     | `60000`                   | Timeout of each request to the provider.                                 |
| `AI_RATE_LIMIT_MAX` | `20`                      | Assist requests per minute, per admin or admin API token.                |

The key is read from the environment only. The admin never shows it and has no field to enter it.

### Anthropic

```sh
AI_PROVIDER=anthropic
AI_MODEL=<a model ID from your Anthropic console>
AI_API_KEY=<your API key>
```

Requests go to `https://api.anthropic.com/v1/messages`. JSON answers use structured outputs.

### OpenAI

```sh
AI_PROVIDER=openai
AI_MODEL=<a model name from your OpenAI account>
AI_API_KEY=<your API key>
```

Requests go to `https://api.openai.com/v1/chat/completions`. JSON answers use `response_format`.

### OpenAI-compatible servers (Ollama, LM Studio, vLLM)

```sh
AI_PROVIDER=openai-compatible
AI_MODEL=llama3.2-vision
AI_BASE_URL=http://127.0.0.1:11434/v1
# AI_API_KEY=   only if your server wants one (sent as a Bearer token)
```

Shapio sends Chat Completions requests to `AI_BASE_URL/chat/completions`. Compatible servers differ in what
structured output they support, so the expected JSON shape goes into the prompt instead. Shapio checks every
answer, asks the model to correct an invalid one once, and otherwise answers `502 ASSIST_INVALID_OUTPUT`.

Loopback and private addresses are allowed in `AI_BASE_URL`: it's operator configuration, not something an
admin can type in. The webhook allowlist (`OUTBOUND_PRIVATE_NETWORK_ALLOWLIST`) doesn't apply. Requests still
go through Shapio's outbound client: no redirects, bounded time and response size.

Alt text needs a model that accepts images. With one that doesn't, the provider rejects the image and alt
text answers `422 ASSIST_VISION_UNSUPPORTED`. Every other action still works.

#### Trying it with Ollama

1. Install Ollama and pull a vision model: `ollama pull llama3.2-vision`.
2. Start it (`ollama serve`, or the desktop app). It listens on `127.0.0.1:11434`.
3. Set the three variables above and restart Shapio.
4. `GET /api/admin/assist/status` (or **Settings → Assist**) shows `enabled: true` and the model.
5. Write alt text for an image in the media library, translate an entry, and run "Propose fixes" for missing
   locales in the Inbox. Check that the drafts appear in a change set marked as proposed by assist, and that
   nothing was published.

## What is sent to the provider

Only what the action needs, and only when a person (or an admin API token) asks for it:

| Action       | Sent                                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alt text     | The image, re-encoded as a JPEG of at most 1024 px (no EXIF or GPS metadata), and its file name.                                                                                                                                                     |
| Summarize    | The entry's rich-text body as plain text (up to 60,000 characters), its title, the target field's label, help text and length limits.                                                                                                                |
| Translate    | The text of the entry's localized fields (strings, texts, rich-text paragraphs and headings, image alt and title, also inside components and dynamic zones), with field length limits. Slugs, numbers, media, relations and code blocks aren't sent. |
| Rewrite      | The selected text and the instruction.                                                                                                                                                                                                               |
| Schema draft | The description, and the API IDs, kinds and labels of your existing content types and components.                                                                                                                                                    |
| Content-ops  | What the actions above send, for each finding it works on.                                                                                                                                                                                           |

Private media and fields marked not public are sent when the person asking can read them. They are sent to
the provider **you** configured and to nobody else. If your policy doesn't allow that for some content, use a
local model (Ollama), or leave assist off.

Content written by people is always sent inside a delimited block. The model is told that this block is data
to work on, never instructions, so a sentence such as "ignore your instructions" inside an entry stays text.
Field settings and the task go in the system prompt.

### What Shapio keeps

Each assist request writes one row to `assist_runs`: who, which action, provider and model, input and
output token counts, duration, and the outcome. No prompt or answer text is stored. It also writes an audit
event (`assist.alt_text`, `assist.summarize`, `assist.translate`, `assist.rewrite`, `assist.schema_draft`,
`assist.content_ops`) with the same metadata and the IDs involved (asset, entry, model, locales).
`assist_runs` rows are deleted after `USAGE_RETENTION_DAYS`. The proposals of a content-ops run are kept as
the result of its job until finished jobs are pruned (`RETENTION_DAYS`).

## In the admin

The admin reads `GET /status` once and keeps the answer for five minutes; assist only changes with a
restart anyway. While assist is off, every assist control is hidden. Settings → Assist is the exception: it
always exists and says assist is off, with a link to this page.

Every result is something you review first. It fills a field, replaces a selection when you say so, or lands
as a draft. Nothing is published.

- **Rewrite** (the floating toolbar over selected rich text, "Rewrite…"): type an instruction, or use
  Shorten or Expand. The proposal opens in an editable box; **Replace selection** puts it in place. If the
  selected text changed while the model was working, Replace refuses and asks you to select it again. The
  proposal is plain text: bold, italic, links and code in the selection are not kept.
- **Suggest alt text**: beside the alt text of an image in rich text, a media field, the cover (Settings
  drawer → Cover) and a file's details in the media library. Images only. It fills the alt text input, and
  you save as usual.
- **Summarize from body**: in a property's popover under the title, for string and text properties (not the
  title) of a content type with a rich-text body. It fills the property, and you review it before saving.
- **Translate {locale} from {source}**: in the Settings drawer's locale list, beside each locale the entry
  doesn't have yet, and in the notice shown when you open a locale that isn't started. It saves the
  translation as that locale's first draft and opens it with a "Proposed by {model}" banner. The banner lists
  any translation issues by field (for example a value over its limit), and you can dismiss it.
- **Describe it** (New content type): describe what editors will write, then **Propose content types**. You
  see the proposed types and their fields. **Add to change set** saves them as schema drafts into the newest
  open change set, or a new one titled "Content types proposed by {model}", and opens its review. Nothing goes
  live until someone ships that change set.
- **Propose fixes** (Inbox, on the "Images without alt text" and missing-locale groups): starts a
  content-ops run and follows it.
  - Alt text proposals open in a review list: edit each one, then Accept (saved to the file in the library)
    or Reject.
  - Missing locales link to the change set that holds the new drafts, and say how many entries were left
    alone.
- **Settings → Assist**: whether assist is on, the provider and model, this month's usage (with
  `changes.manage`), and a **Try it** box that runs a rewrite without saving anything.

**Unsaved changes.** Summarize and translate read the entry as it is saved. If the document has unsaved
changes, the admin saves them as a draft first. In a content type without drafts, saving would publish, so
the admin asks you to save yourself instead.

## Actions

All endpoints are under `/api/admin/assist` and are site routes (send `Shapio-Site` or `?site=` on a
multi-site instance). Every action except `status` and reading a run counts against `AI_RATE_LIMIT_MAX`.

| Endpoint                                                        | Needs                                                         | Returns                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /status`                                                   | any admin                                                     | `{ enabled, provider, model, usage? }`. `usage` (this month's runs and tokens on the site) needs `changes.manage`. |
| `POST /alt-text` `{ assetId, locale? }`                         | `media.read`                                                  | `{ alt, model }`. The editor applies it as a normal edit.                                                          |
| `POST /summarize` `{ modelKey, entryId, locale?, fieldApiKey }` | `read` + `update` on the model                                | `{ text, truncated, model }`                                                                                       |
| `POST /translate` `{ modelKey, entryId, from, to }`             | `read` + `update` on the model                                | `{ data, issues, model }`                                                                                          |
| `POST /rewrite` `{ text, instruction, maxLength? }`             | any admin                                                     | `{ text, truncated, model }`                                                                                       |
| `POST /schema/draft` `{ description }`                          | `schema.create`                                               | `{ definitions, model }`                                                                                           |
| `POST /content-ops/propose` `{ rule, modelKey?, fromLocale? }`  | `media.read` (altMissing) or `changes.manage` (localeMissing) | `202 { runId }`                                                                                                    |
| `GET /content-ops/:runId`                                       | who started it, or `media.write` / `changes.manage`           | the run and, once done, its result                                                                                 |

- **Summarize** writes into a string or text property, never the title, of a content type whose document has
  a rich-text body. The summary respects the field's maximum length: if the model's answer is too long it's
  asked once for a shorter one, then cut at a word boundary (`truncated: true`).
- **Translate** proposes the target locale's values of the localized fields you can read and edit. Shared
  fields are never part of it. Bold, italic, links and line breaks are kept. If a paragraph's formatting
  can't be restored, it comes back as plain text with a `FORMATTING_LOST` issue. Values over a field's limit
  come back as they are, with a `TOO_LONG` issue, so the editor can fix them before saving. The source
  locale must exist (`404 ENTRY_LOCALE_NOT_FOUND` otherwise).
- **Schema draft** returns complete definitions with new stable IDs, validated against your current schema.
  They come in the order to save them: components and relation targets first. Nothing is written. The admin
  saves them as schema drafts in a change set for review. New content types that would reference each other
  in a cycle are refused.
- **Content-ops** runs as a background job over up to 50 open findings of one rule that you can see:
  - `altMissing` proposes one library alt text per image, as a list to accept or reject. Applying a proposal
    is a normal media update (`PATCH /api/admin/media/assets/:id` with `{ alt, expectedVersion }`).
  - `localeMissing` translates each entry from `fromLocale` (default: the default locale) and saves the
    missing locale's first draft through the normal save path. All drafts go into one change set marked
    as proposed by assist. A locale that someone created in the meantime is skipped, never overwritten.
    Content types without drafts and publishing are skipped too (`publishesOnSave`), because saving there
    would publish.

### Errors

| Status | Code                        | Meaning                                                                  |
| ------ | --------------------------- | ------------------------------------------------------------------------ |
| 404    | (route not found)           | Assist is off.                                                           |
| 422    | `ASSIST_VISION_UNSUPPORTED` | The model doesn't accept images.                                         |
| 422    | `ASSIST_NOT_AN_IMAGE`       | Alt text for a file that isn't a raster image (SVG included).            |
| 422    | `ASSIST_DECLINED`           | The model declined the request.                                          |
| 429    | `RATE_LIMITED`              | Over `AI_RATE_LIMIT_MAX` this minute.                                    |
| 502    | `ASSIST_INVALID_OUTPUT`     | No valid answer, even after one correction. `details.problems` says why. |
| 502    | `ASSIST_PROVIDER_AUTH`      | The provider rejected the key or model.                                  |
| 502    | `ASSIST_PROVIDER_ERROR`     | The provider failed, timed out or couldn't be reached.                   |
| 503    | `ASSIST_PROVIDER_BUSY`      | The provider is rate limiting.                                           |

## Limits

- No streaming: each answer arrives in one piece, within `AI_TIMEOUT_MS`.
- Long entries are translated in several requests of about 12,000 characters each.
- Content-ops handles at most 50 findings per run. Run it again for more.
- The rate limit is kept in memory per process, like Shapio's other rate limits.
