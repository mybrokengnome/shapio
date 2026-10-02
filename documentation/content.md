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

## Who can do what

Editors create, edit, publish and delete content in every model; read-only users only read. Custom roles grant
these per model and per field, and can limit app users to entries they own ([First admin](first-admin.md#roles),
[End users](end-users.md)).
