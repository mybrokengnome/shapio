# Content

Editors work under **Content**: one list per model, an entry form generated from the model, and per-locale
publishing. Three things are kept apart on purpose:

1. **Saving a draft**: editors' work in progress. Never visible to your sites.
2. **Publishing** a version of an entry, per locale: what the delivery API serves from that moment.
3. **Deploying a site** that reads published content: its build may succeed or fail on its own
   ([Webhooks, deployments and preview](publishing.md)).

## Drafts, autosave and Save

- **Autosave** keeps your edits a moment after you stop typing. It does not create a history entry, and it lets
  required fields stay empty while you work.
- **Save** validates everything (required fields included) and records a **revision**: an immutable snapshot
  of that locale's document.
- Editing a published entry changes only its draft. The published version stays live, untouched, until you
  publish again. The entry's status then reads _modified_.

If someone else saved the same entry since you opened it, your save is refused rather than overwriting theirs;
the form offers to reload with your changes kept, or to discard them. The same happens if the model changed
while you were editing.

The server validates every save, whatever editor or API sent it: required values, formats, lengths,
uniqueness, rich-text structure, and that relations and media point at entries and files that exist.

## Publishing

**Publish** makes the current draft of the chosen locale live, as one revision, atomically. **Unpublish** takes
a locale offline. Publishing one locale never changes another ([Localization](localization.md)). When other
published locales still serve older values of shared fields, the publish dialog offers to publish them too.

A model without drafts (drafts turned off on the model) publishes every save at once.

List views publish, unpublish and delete several entries at once.

## History and restore

Each entry's **History** lists its revisions per locale: when, why (save, publish, restore), by whom. Open one
to see it; **Restore this version** brings it back as the new draft (a new revision; nothing is rewritten). Publish it to
make it live.

## Deleting

Deleting an entry removes it from the admin and the APIs; its revisions stay as history. An entry that other
entries still point at cannot be deleted until those references are removed; the error lists them.

## Scheduling

Publishing → Scheduled publishes or unpublishes one entry (one locale) at a set time. The job queue runs it
exactly once, even across restarts, and the list shows how each run went.

## Change sets

A **change set** groups publications of several entries (publish or unpublish, per locale), and schema edits
if you like, and ships them together as one snapshot: now, or at a scheduled time. Either every item goes live
or none does; a failure (an item that no longer validates, a hook that rejects it) leaves everything as it was
and the set shows why. Change sets replace releases; see [Change sets, snapshots and restore](change-sets.md).

## Content health and the Inbox

Shapio checks every entry against a set of health rules and lists what it finds in the Inbox under **Needs
you**, one group per rule. Findings are warnings and block nothing themselves, though publishing still
refuses content that fails validation (an empty required field, a taken unique value). A finding disappears
by itself once the content is fixed, so there is nothing to dismiss. On an instance with several
sites, each site sees the findings for its own entries ([Sites](sites.md)).

| Rule                  | Inbox group                  | What it detects                                                                                                                                   | Models      | Propose fixes |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------- |
| `requiredEmpty`       | Required fields left empty   | A required field that is empty in a locale's draft (autosave lets you leave one empty while you work).                                            | all         | no            |
| `relationMissing`     | Links to deleted entries     | A relation in a draft that points at an entry that no longer exists.                                                                              | all         | no            |
| `uniqueConflict`      | Values already taken         | A unique field whose draft value is already used by another entry's published version, so publishing it would fail.                               | with drafts | no            |
| `altMissing`          | Images without alt text      | An image (in a media field or a rich-text body) with no alt text of its own and none in the media library. Files that aren't images are skipped.  | all         | yes           |
| `relationUnpublished` | Links to unpublished entries | A relation in a draft whose target has no published version in that locale (any locale, for a target that isn't localized), so delivery drops it. | with drafts | no            |
| `localeMissing`       | Translations not started     | A configured locale in which the entry has no version yet.                                                                                        | localized   | yes           |
| `unpublishedChanges`  | Changes not published        | A published locale with unpublished draft changes, last saved or autosaved more than `HEALTH_STALE_DAYS` (default 14) ago.                        | with drafts | no            |
| `staleDraft`          | Drafts going stale           | A locale that was never published, its draft last saved or autosaved more than `HEALTH_STALE_DAYS` ago.                                           | with drafts | no            |

"With drafts" means models with drafts turned on. The table follows the order of the groups in the Inbox.

**When the rules run.** An entry is checked again whenever it is saved, published, unpublished or deleted, and
whenever the media library details of an image it uses change (its alt text, for example). Autosaves don't
trigger a check. Entries are also checked again after a schema change goes live (a model change re-checks
only that model's entries), after the locales change, and once a day, which is how the two time-based rules
(`staleDraft` and `unpublishedChanges`) come up. Opening the publish pre-flight checks the entry at once, and
the pre-flight repeats `altMissing` and `relationUnpublished` as warnings for the locales you publish.

**Propose fixes.** With [assist](assist.md) turned on, the "Images without alt text" and "Translations not
started" groups have a **Propose fixes** button. It proposes alt text for you to review, or creates the
missing locales as drafts in a change set. Nothing is published. The other rules have no automatic fix:
each finding links to the entry so you can fix it there.

## Who can do what

Editors create, edit, publish and delete content in every model; read-only users only read. Custom roles grant
these per model and per field, and can limit app users to entries they own ([First admin](first-admin.md#roles),
[End users](end-users.md)).
