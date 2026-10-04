# Admin design system

How the Shapio admin looks and how to build a screen that fits. The reference is
`docs/design/admin-mockup.png` (the entry editor). Everything here exists in code; this file describes it.
Rules from `CONTRIBUTING.md` (Tailwind only, `cn()`, semantic tokens, dark mode, translations) still apply.

## Tokens

Components use semantic tokens, exposed to Tailwind as colours (`bg-card`, `text-muted-foreground`, ...),
never hex, arbitrary colours (`bg-[#…]`) or Tailwind's default palette (`bg-green-100`, `text-white`).
`src/test/conventions.test.ts` fails on all three.

### Themes

A theme is a named, complete set of the tokens below for a light variant, a dark variant, or both. The token
list is `THEME_TOKENS` in `@shapio/schema` (shared with the API, which validates extension themes). Each
built-in theme is one file, `src/styles/themes/<key>.css`, imported by `src/styles/index.css` and scoped to
`[data-theme='<key>']` (light, or the only variant) and `[data-theme='<key>'].dark`. Shapio's values also sit
on zero-specificity `:where(:root)` / `:where(:root.dark)` blocks: the fallback before the theme script runs
or when a saved theme's CSS is gone. `index.css` maps the tokens to Tailwind (`@theme inline`) and holds no
colour values.

- `public/theme-init.js` sets `data-theme` and `dark` on `<html>` before first paint from the theme store
  (`stores/theme.ts`: `theme`, `appearance`, and the theme's cached `variants`), so there is no flash;
  `hooks/useApplyTheme.ts` keeps them in step afterwards. A single-variant theme renders its only variant
  whatever the appearance, and `dark` is set for every dark-rendering theme, so `dark:` variants and
  `color-scheme` follow. `src/test/themeInit.test.ts` keeps the script and `helpers/theme.ts` in step.
- `src/test/contrast.test.ts` checks every theme and variant: exactly `THEME_TOKENS`, `#rrggbb` values, every
  text pair at 4.5:1 and every control/focus pair at 3:1 (pairs in `@shapio/schema` `themes/contrast.ts`).
  `src/test/classicTheme.test.ts` pins Classic to the original values.
- A preview of another theme is a subtree with `data-theme` (and `dark`): `ThemeSwatches`. Swatches only,
  never live components, since `dark:` variants match ancestors.
- Status tones are per theme (the shared ones fail on plum and cream).
- Extensions add themes in `shapio.config` (`themes`); see `documentation/extensions.md`.

| Theme            | Variants     | Character                                                                       |
| ---------------- | ------------ | ------------------------------------------------------------------------------- |
| **Shapio**       | light + dark | the default: plum, cream and acid yellow                                        |
| **Classic**      | light + dark | the original cobalt look, values unchanged (the logo is the new mark)           |
| **Murdered out** | dark only    | blacked out: pure black, white actions, no hue except status tones and the logo |
| **Snowed**       | light only   | white and snow grey, ink actions, ice-blue selection                            |

Final values (every pair checked by the contrast test):

| Token                      | Shapio light          | Shapio dark           | Classic light         | Classic dark          | Murdered out          | Snowed                |
| -------------------------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- |
| `background`               | `#f7f2ea`             | `#231527`             | `#faf9f6`             | `#0f0f0e`             | `#000000`             | `#ffffff`             |
| `foreground`               | `#1e1422`             | `#f5ebd8`             | `#0f172a`             | `#f2f1ee`             | `#f2f2f2`             | `#0f172a`             |
| `card`                     | `#ffffff`             | `#2b1b30`             | `#ffffff`             | `#161615`             | `#0a0a0a`             | `#f7f9fc`             |
| `popover`                  | `#ffffff`             | `#352239`             | `#ffffff`             | `#1c1c1a`             | `#141414`             | `#ffffff`             |
| `primary`                  | `#1e1422`             | `#e9f26e`             | `#2563eb`             | `#2563eb`             | `#f2f2f2`             | `#0f172a`             |
| `primary-foreground`       | `#f7f2ea`             | `#1e1422`             | `#ffffff`             | `#ffffff`             | `#000000`             | `#ffffff`             |
| `primary-hover`            | `#3a2541`             | `#f3fa8a`             | `#1d4ed8`             | `#1d4ed8`             | `#d4d4d4`             | `#1e293b`             |
| `secondary`                | `#efe8dd`             | `#352239`             | `#f1efea`             | `#232321`             | `#1a1a1a`             | `#eef2f7`             |
| `muted`                    | `#f3ede4`             | `#2e1d33`             | `#f5f3ee`             | `#1f1f1d`             | `#111111`             | `#f3f6fa`             |
| `muted-foreground`         | `#5b4c61`             | `#c9b9cf`             | `#475569`             | `#a9a7a1`             | `#9a9a9a`             | `#4b5a6e`             |
| `accent`                   | `#eff3b4`             | `#45304b`             | `#eceae4`             | `#262a3a`             | `#262626`             | `#dce6f5`             |
| `accent-foreground`        | `#1e1422`             | `#f5ebd8`             | `#0f172a`             | `#c7d0fd`             | `#ffffff`             | `#0f172a`             |
| `destructive`              | `#b42318`             | `#ff8a80`             | `#b91c1c`             | `#ef5350`             | `#ff6b6b`             | `#b91c1c`             |
| `destructive-muted`        | `#fbe1dc`             | `#4a1f2a`             | `#fee2e2`             | `#3b1519`             | `#2a0e0e`             | `#fee2e2`             |
| `success` / `-muted`       | `#17703a` / `#dcf2e1` | `#6ee7a0` / `#1d3a2b` | `#15803d` / `#dcfce7` | `#4ade80` / `#12301f` | `#4ade80` / `#0c2415` | `#15803d` / `#dcfce7` |
| `warning` / `-muted`       | `#965006` / `#fbecc8` | `#fcc94d` / `#43311a` | `#b45309` / `#fef3c7` | `#fbbf24` / `#36270a` | `#fbbf24` / `#2a1f05` | `#a14b07` / `#fef3c7` |
| `info` / `-muted`          | `#4a2e55` / `#ece2f0` | `#c3cbff` / `#33295a` | `#1d4ed8` / `#e0e7ff` | `#a5b4fc` / `#1e2a4a` | `#d4d4d4` / `#1f1f1f` | `#1d4ed8` / `#e0e7ff` |
| `border`                   | `#e4dcd2`             | `#3e2b43`             | `#e2dfd8`             | `#2c2c29`             | `#262626`             | `#d9e0ea`             |
| `input`                    | `#8a7c84`             | `#8f7c95`             | `#808898`             | `#76756f`             | `#737373`             | `#7c8899`             |
| `ring`                     | `#4a2e55`             | `#e9f26e`             | `#2563eb`             | `#a5b4fc`             | `#ffffff`             | `#2563eb`             |
| `link`                     | `#4a2e55`             | `#e9f26e`             | `#2563eb`             | `#a5b4fc`             | `#d4d4d4`             | `#1d4ed8`             |
| `sidebar`                  | `#f0e9de`             | `#1c1020`             | `#f3f1ec`             | `#0b0b0a`             | `#050505`             | `#f3f6fa`             |
| `sidebar-primary`          | `#1e1422`             | `#e9f26e`             | `#2563eb`             | `#a5b4fc`             | `#f2f2f2`             | `#0f172a`             |
| `brand-letters`            | `#231527`             | `#f5ebd8`             | `#231527`             | `#f5ebd8`             | `#f2f2f2`             | `#0f172a`             |
| `brand-panel-from` / `-to` | `#352239` / `#1e1422` | `#352239` / `#140b17` | `#2563eb` / `#1d4ed8` | `#1d4ed8` / `#0f172a` | `#141414` / `#000000` | `#dce6f5` / `#f7f9fc` |

The remaining tokens (`*-foreground` on cards and popovers, `destructive-foreground`, `overlay`, the other
`sidebar-*`) are in the theme files. `brand-logo` (`#e9f26e`) and `brand-logo-foreground` (`#231527`) are the
same in every theme; `brand-panel-mark` is the logo yellow everywhere today.

In Shapio light the yellow is a background highlight only (`accent`, selection): as text, as a hover under
light text or as a focus ring it fails contrast on cream, so actions are ink and focus and links are plum.

| Token                                                   | Use                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `background`                                            | the page                                                                                    |
| `card`, `popover`                                       | cards, panels, tables, dialogs, sheets, menus                                               |
| `foreground`                                            | text                                                                                        |
| `muted`, `muted-foreground`                             | subtle fills (table header, hover, icon tiles, info alert), secondary text                  |
| `primary` (+ `primary-hover`, `primary-foreground`)     | the one accent: primary buttons, active tab bar, icons on tiles; never a surface            |
| `accent`, `accent-foreground`                           | selection and menu focus (selected tiles add a `primary` border)                            |
| `border`                                                | 1px borders everywhere; cards have no shadow                                                |
| `input`                                                 | control borders and unchecked switches (3:1 on every surface, WCAG 1.4.11)                  |
| `ring`                                                  | focus rings, always `ring-[3px] ring-ring/50`                                               |
| `link`                                                  | text links, and the dark blockquote rule in rich text                                       |
| `success`, `warning`, `info`, `destructive` + `*-muted` | status text/dots on their tinted backgrounds                                                |
| `overlay`                                               | sheet and dialog backdrops (`bg-overlay/40`)                                                |
| `sidebar*`                                              | the sidebar column, active pill, active bar (`sidebar-primary`)                             |
| `brand-logo`, `brand-logo-foreground`                   | the mark only (`Logo`): the yellow tile and plum S; never UI                                |
| `brand-letters`                                         | the wordmark letters (`Wordmark`)                                                           |
| `brand-panel-from`, `-to`, `-foreground`, `-mark`       | the signed-out brand panel (`AuthLayout/BrandPanel`): gradient, its text, the panel's mark  |
| `cobalt`, `periwinkle`, `ink`, `ivory`                  | the original brand palette, kept as fixed `@theme` colours for now; unused by any component |

Radius: `--radius` is 8px. Controls and buttons `rounded-lg` (8px), cards/panels/dialogs `rounded-xl`
(12px), chips `rounded-full`.

`--statusbar-h` (32px) is the status bar's height. Anything fixed or sticky at the bottom of the page on
md and up (bulk-action bars, sticky footers) sits at `bottom-(--statusbar-h)` or adds it to its offset;
toasts already do.

## Type

### Fonts

Both faces are variable, self-hosted from `public/fonts` (latin + latin-ext subsets, `font-display: swap`,
no runtime request to a font service), declared in `src/styles/index.css`.

| Face                                                     | Token        | Use                                                          | Licence                                          |
| -------------------------------------------------------- | ------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| Manrope (wght 200–800, roman)                            | `font-sans`  | the whole UI, the default on `body`                          | SIL OFL 1.1, `public/fonts/OFL.txt`              |
| Source Serif 4 (wght 200–900, roman + italic, no `opsz`) | `font-serif` | the reading face: rich-text body in the document canvas only | SIL OFL 1.1, `public/fonts/OFL-SourceSerif4.txt` |

The serif is for what people write, never for chrome: no serif buttons, labels, tables, menus or titles
outside the canvas. The document title stays Manrope (`text-display`).

### Scale

| Role                                                   | Class                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| Document title (44/700, tight, 1.1)                    | `text-display` (only the entry document's title uses it)              |
| Canvas body (19/1.65, serif)                           | `font-serif text-canvas` (only rich text in the document canvas)      |
| Page title (28/700, tight)                             | `text-title` (only `PageHeader` uses it)                              |
| Section / panel / card title                           | `text-base font-semibold`                                             |
| Label                                                  | `text-sm font-semibold` (the `Label` primitive)                       |
| Body, control text                                     | `text-sm`                                                             |
| Meta: breadcrumb, meta line, hints, field descriptions | `text-meta` (13px) `text-muted-foreground`                            |
| Table header, group labels                             | `text-xs font-semibold uppercase tracking-wide text-muted-foreground` |
| Tiny chips                                             | `text-2xs` (11px)                                                     |

`text-display`, `text-canvas`, `text-title`, `text-meta` and `text-2xs` are theme tokens registered with
tailwind-merge in `helpers/cn.ts`, so `cn('text-meta', 'text-foreground')` keeps both. Don't use arbitrary sizes
(`text-[13px]`).

**Canvas body.** Rich text in the document canvas is `font-serif text-canvas` (19px, 1.65 line height)
in a `max-w-prose` measure, set once by the canvas. Headings inside the canvas stay
serif at 600 on the default scale (`text-3xl` H2, `text-2xl` H3); code uses `font-mono`. Only the entry
document uses them: `text-display` for its title, `text-canvas` for its rich text.

## Density

- Buttons `h-9` (default), `h-8` (`size="sm"`) in tables and toolbars, `h-10` (`lg`). Icon buttons
  `icon` 36, `icon-sm` 32. Icon 16px before the label.
- Inputs and selects `h-10` in forms, editors and sheets; `h-9` in toolbars and filter rows
  (`<Input inputSize="sm">`, `<SelectTrigger size="sm">`).
- Table rows 44px (`TableCell` is `h-11`), header 40px on a muted band.
- Panel/card padding 20px (`p-5`); sheet and dialog padding 24px.
- Page gutter `px-4 sm:px-8 py-7` (the Shell's); sections 24px apart (`Page`), form fields 20px
  (`space-y-5` / `FieldGroup`), groups of sections 32px.

## Helper-text rule

A control gets at most one short visible line of helper text (`description` on the `Form*` fields), and
only when it changes what the person does: a validation outcome, a breaking-change warning, "nothing is
saved until…". Anything that explains goes behind an info icon: the `hint` prop on `FormTextField`,
`FormTextareaField`, `FormSelectField`, `FormSwitchField`, or `InfoHint`/`HintedLabel` directly. Section
descriptions are one line or none. Exception: a content field's `description` in `fields/FieldControl`
is written by the model's author and stays visible (13px meta).

## Shell

- No desktop top bar. Sidebar (wordmark + collapse button, navigation, account menu),
  the screen, and the 32px **status bar** (md and up: section name, "Schema v{n} · live, no restart
  needed"). The status bar reads the schema version from the same cache as the builder's poll and never
  polls by itself; it isn't a live region.
- Below lg (1024px) the sidebar is a sheet, opened from a 48px sticky row (trigger, wordmark, avatar
  menu). `useIsMobile()` is true below lg.
- Theme is in the account menu (Profile, Theme ▸ the themes with their swatches, then Colour mode
  System/Light/Dark, Sign out; the same body is the signed-out screens' `ThemeMenu`), with a one-click
  light ⇄ dark switch (`ThemeToggle`) beside it in the sidebar footer and in the phone bar. The switch saves
  an explicit Light or Dark; on System it switches to the opposite of what is rendered. For a single-variant
  theme the colour modes are disabled with a note, and the switch is `aria-disabled` with a tooltip saying
  why. Settings → Appearance shows the themes as cards (`RadioTile` with `ThemeSwatches`) and the modes.
- A screen renders only its content: start with `Page` and `PageHeader`; don't add headers, gutters or
  backgrounds of your own.

### Sites

- The URL carries the site: `/admin/s/<siteKey>/…`. Routes are site-free (`/content/$modelKey`): the
  router's `rewrite` (`app/siteRewrite.ts`) adds and strips the prefix, so links never name a site.
  Network pages (`/admin/network/*`) and the signed-out screens carry none. A URL without a site lands on
  the last site this browser used, else the primary one.
- The site is fixed for a page load (`app/currentSite.ts`); the API client names it on every request.
  Opening another site is a full navigation (`goToSite`), so no cache or store crosses sites.
- **`SiteSwitcher`** (sidebar header, under the wordmark): the current site, the admin's other sites and,
  for admins with a network action, "Network". On network pages the sidebar shows the network group
  (Sites, Users, Roles, Audit log) instead of the site's navigation.
- A site the admin has no role on shows `NoSiteAccess` in the frame (switcher, no navigation, no search);
  an unknown site key shows `SiteNotFound`.
- Show a site only where there is more than one: assignment forms are a role alone on a single-site
  instance, rows of site + role otherwise.

## Component catalogue

Shared components live in `src/components/<Name>` (Shapio's) and `src/components/ui` (shadcn primitives,
restyled to the tokens). Check here before building something.

### Layout

**`Page`** `{ width?: 'full' | 'default' | 'narrow'; className?; children }`
A screen's content column: `default` max 72rem, `narrow` max 48rem (single forms, settings pages),
`full` for wide tables, grids and editors with side panels. Sections are 24px apart.

- Do: wrap every screen in one `Page`.
- Don't: set your own `max-w-*`/`mx-auto` on a screen root.

**`PageHeader`** `{ title; breadcrumb?: BreadcrumbItem[]; badge?; meta?; actions?; tabs?; sticky?; className? }`
`BreadcrumbItem = { label: string; link?: LinkOptions }` (build links with
`linkOptions({ to: '/content/$modelKey', params })`). The trail excludes the current page. `badge` sits
beside the title (a `StatusChip`), `meta` is one 13px line under it ("API ID article · v2", "112
entries"), `actions` on the right with the primary last, `tabs` full width underneath (`LinkTabs`, or a
`TabsList variant="underline"` inside your `Tabs`). `sticky` keeps the header (with its actions) at the
top of editors while the form scrolls.

- Do: put every screen title through it. Don't: write `<h1>` or header markup in a feature.
- Don't: add a description paragraph under the title; use `meta` or nothing.

**`Panel`** `{ title?; titleAs?: 'h2' | 'h3'; description?; actions?; flush?; 'aria-label'?; className?; bodyClassName?; children }`
A card with a header row (16/600 title, one-line description, actions on the right). With a title it is
a labelled region (`role=region`, named by the title). `flush` removes the body padding and puts a border
under the header: use it for tables, lists, rails. `bodyClassName` is for layout inside the body (grid,
gap), not for restyling the panel.

- Do: side panels, settings groups, dashboard blocks, editor columns.
- Don't: nest panels; don't use `Card` for these (it's the low-level primitive).

**`SubNav` + `SubNavGroup` + `SubNavLink`**
`SubNav { label; className?; children }`, `SubNavGroup { label?; children }`,
`SubNavLink` = a router link (`to`, `params`, `search`…) with an icon and label.
A feature's section navigation: a 224px card column on lg, a horizontal scroller below. Group labels are
12px uppercase. Used by Content (`ModelNav`) and Settings (`Nav`); Publishing uses `LinkTabs`.

```tsx
<SubNav label={t('settings.sections')}>
  <SubNavGroup label={t('settings.account')}>
    <SubNavLink to="/settings/profile">
      <UserRound aria-hidden="true" />
      {t('settings.profile')}
    </SubNavLink>
  </SubNavGroup>
</SubNav>
```

**`LinkTabs`** `{ label; tabs: { to; label }[]; className? }`
Route tabs, underlined (2px primary bar under the current one, `aria-current="page"`). For tabs that
switch state in place (Models' `?tab=`), use `Tabs` with `<TabsList variant="underline">`; it keeps the
tab/tablist semantics.

### Data

**`ui/table`** (restyled): muted 40px header band with 12px uppercase labels, 44px rows, hover
`bg-muted/50`, selected (`data-state="selected"`) `bg-accent/40`. Every list table gets this without
changes. Right-align numbers with `text-right tabular-nums` on the cell.

**`TableCard`** `{ children; toolbar?; footer?; className? }`
The surface around a list table: border, 12px radius, an optional toolbar row above (search, filters,
bulk actions) and footer row below (the pager).

**`RowTitle`** `{ asChild?; className?; children }`
The first column's title: ink, 600, primary on hover when it's a link.
`<RowTitle asChild><Link to="/models/$modelId" params={{ modelId }}>{label}</Link></RowTitle>`.

**`PagePager`** `{ page; pageSize; total; pageSizes?; onPageChange; onPageSizeChange?; className? }`
For page-numbered lists with a total (content lists): "26–50 of 112", page-size select, previous/next
icon buttons.

**`CursorPager`** `{ onFirst; onPrevious; onNext; className? }`
For cursor lists without a total (audit, media, app users): Newest / Previous / Next as 32px icon
buttons (named by `aria-label`).

**`StatusChip`** `{ tone: StatusTone; label; live?; size?: 'default' | 'sm'; className? }`
`StatusTone = 'neutral' | 'progress' | 'scheduled' | 'success' | 'warning' | 'danger' | 'muted'`.
A dot + label pill; `progress` shows a spinner while `live` (default true). Map states to tones:
draft → `neutral`, changed/modified → `warning`, published/ready/delivered → `success`, scheduled →
`scheduled`, failed/dead → `danger`, pending/running/processing → `progress`, cancelled/archived →
`muted`.

- Do: every state indicator (entries, jobs, change sets, assets, deliveries, pending schema change).
- Don't: use `Badge` colours for state; don't rely on colour alone (the label is required).

**`EmptyState`** `{ title; description?; icon?; action?; size?: 'panel' | 'page'; className? }`
Icon tile, 16/600 title, one line, one primary action. `page` (default) sits on its own card surface
with 64px padding; `panel` has no surface and 40px padding, for inside a `Panel` or `TableCard`.
`QueryView`'s `empty` takes one; `ErrorState` uses it.

**`IconTile`** `{ icon; size?: 'sm' | 'md' | 'lg'; tone?: 'accent' | 'muted' | 'success' | 'warning' | 'danger'; className? }`
32/36/40px tinted square with the icon (decorative, `aria-hidden`). Cards, pickers, list rows, empty
states, dashboard stats. The `accent` tone is a neutral `muted` tile with a cobalt icon (periwinkle in
dark), so `accent` stays a selection colour.

### Forms

**`Form*` fields** (`FormTextField`, `FormTextareaField`, `FormSelectField`, `FormSwitchField`,
`FormCheckboxGroup`, `FormRadioGroup`): react-hook-form bound, label, inline error, `aria-invalid`/`aria-describedby`
wired. New on the first four: `hint?: string`, an explanation behind an info icon beside the label
(its text is also linked to the control with `aria-describedby`). `description` stays for one visible
line that changes what the person does.

`FormRadioGroup` binds a `string` (exactly one choice) and shows each option's `description` under its
label; use it where only one option makes sense (an admin user's role), `FormCheckboxGroup` for several.

**`InfoHint`** `{ about; children; id?; className? }`
A 14px info icon button that opens a popover (works on tap and with Enter; tooltips don't). `about`
names the button "More about {about}". Pass `id` and add it to the control's `aria-describedby`: the
text is rendered hidden under that id.

**`HintedLabel`** `{ htmlFor; label; hint?; hintId?; className? }`
A field label with an optional `InfoHint`, for controls that aren't `Form*` fields.

**`FormSheet`** `{ open; onOpenChange; title; description?; dirty; pending; submitLabel; pendingLabel; onSubmit; size?: 'sm' | 'md' | 'lg'; bodyClassName?; onCloseAutoFocus?; children }`
Create or edit a record in a right-hand sheet while the list stays in view: fixed header, scrolling body
(a `FieldGroup`, 20px between fields), footer with Cancel then the primary action. Closing over unsaved
edits (`dirty`) asks first. `onCloseAutoFocus` lets a caller keep focus where it is when the sheet closes
(call `event.preventDefault()`), e.g. on a `SecretReveal` that just took it.

```tsx
<FormSheet
  open={open}
  onOpenChange={setOpen}
  title={t('apiTokens.createTitle')}
  dirty={form.formState.isDirty}
  pending={create.isPending}
  submitLabel={t('common.create')}
  pendingLabel={t('common.saving')}
  onSubmit={form.handleSubmit(submit)}
>
  <FormTextField control={form.control} name="name" label={t('apiTokens.name')} />
</FormSheet>
```

**`InlineConfirm`** (`components/InlineConfirm`)
Common: `{ title; description?; confirmLabel; cancelLabel?; pendingLabel?; tone: 'danger' | 'default'; onConfirm: () => void | Promise<unknown>; align?; side?; onCloseAutoFocus? }`
Trigger mode: `+ { trigger: ReactElement }`. Anchored mode: `+ { open; onOpenChange; children: ReactElement }`.
Confirms a routine action where it was asked for: a modal popover with role `alertdialog`, named by
`title` and described by `description` (one line of consequence). `danger` gives a red Confirm and starts
focus on Cancel; `default` a primary Confirm with focus on it. Enter activates the focused button, Escape or
a click outside cancels, focus returns to the opener. If `onConfirm` returns a promise (`mutateAsync`), the
popover stays open with a spinner until it settles: it closes on success and shows the error on failure.
`onCloseAutoFocus` runs as it closes; call `event.preventDefault()` to keep focus where the caller put it
(e.g. on a `SecretReveal` shown after a confirmed rotate).
Use anchored mode for menu items: open it from the item's `onSelect`, wrap the menu's trigger button as
`children`, and prevent the menu's own focus return while handing off.

```tsx
// Trigger mode
<InlineConfirm
  tone="danger"
  title={t('sessions.revokeTitle')}
  description={t('sessions.revokeDescription')}
  confirmLabel={t('common.revoke')}
  onConfirm={() => revoke.mutateAsync(session.id)}
  trigger={<Button variant="destructive-ghost" size="sm">{t('common.revoke')}</Button>}
/>

// Anchored mode, from a row menu
<InlineConfirm tone="danger" open={confirm.target?.id === role.id} onOpenChange={confirm.onOpenChange} …>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon-sm" aria-label={t('common.actions')}>…</Button>
  </DropdownMenuTrigger>
</InlineConfirm>
```

**`SecretReveal`** `{ title; description; label; secret; dismissLabel?; onDismiss; hint?; className? }`
A one-time secret (API token, signing secret) shown inline at the top of the page where it was created,
never in a URL: a labelled panel with the read-only secret, a copy button, optional `hint` and the
dismiss button ("I've saved it"). It focuses its copy button when it appears, and leaving the page before
dismissing it asks first (`UnsavedChangesGuard`).

**`ConfirmDialog`** `{ open; onOpenChange; title; description; confirmLabel; cancelLabel?; destructive?; onConfirm; acknowledgement?; pending?; pendingLabel?; error? }`
The one blocking dialog, for irreversible acknowledgements only (see Dialogs). Focus starts on Cancel.
`acknowledgement` adds a checkbox that must be ticked before Confirm (unticked on every open). Passing
`pending` switches to async mode: Confirm no longer closes the dialog (close it on success), shows
`pendingLabel` while pending, the dialog can't be dismissed meanwhile, and `error` shows above the buttons.

**`UnsavedChangesGuard`** `{ when; title?; description?; stayLabel?; leaveLabel? }`
While `when`, in-app navigation asks before leaving and the browser warns on reload. The copy defaults to
"Discard unsaved changes?".

### Assist

Editor assists show only while the server says assist is on (`useAssistEnabled()` from `api/assist`, one
cached read of `GET /assist/status`); with it off they render nothing. Every result is a proposal the person
reviews: it fills an input, replaces a selection on request, or lands as a draft. Nothing publishes.

**`AssistButton`** `ButtonProps & { pending; pendingLabel; type?: 'button' | 'submit' }`
Runs an assist: a sparkle icon (spinner and `pendingLabel` while the model works), `ghost`/`sm` by default.

**`AssistError`** `{ error; id?; className? }`
Why an assist failed, inline where it was asked for (`role="alert"`, 13px destructive): the per-actor rate
limit and every `ASSIST_*` code have their own sentence (`describeAssistError`), anything else the server's
message.

**`SuggestAltButton`** `{ assetId; mimeType; locale?; onSuggest; disabled?; className? }`
"Suggest alt text" beside an alt input (rich-text image, media field, cover, library details). Images only;
`onSuggest` puts the proposal in the caller's input and the person saves.

### Primitives (`components/ui`)

- `Button` variants: `default` (primary), `outline`, `ghost`, `destructive`, `destructive-ghost`
  (quiet red, for Remove in toolbars and panels), `secondary`, `link`. Sizes: `default`, `sm`, `lg`,
  `xs`, `icon`, `icon-sm`, `icon-lg`, `icon-xs`.
- `Input` `inputSize?: 'default' | 'sm'`; `SelectTrigger` `size?: 'default' | 'sm'`.
- `Tabs`: `TabsList variant?: 'default' | 'underline'` (segmented control or page tabs).
- `Sheet`: `SheetContent` `side?` (`right` default) and `size?: 'xs' | 'sm' | 'md' | 'lg'` (360/400/560/720px
  from the sm breakpoint, full width on phones); `SheetHeader`, `SheetBody` (scrolling middle), `SheetFooter`
  (bordered action row on a muted band, Cancel then the primary action). Don't set
  widths with `className`; use `size`. `SheetContent nonModal` (paired with `<Sheet modal={false}>`) drops
  the overlay and focus trap so the page stays interactive; only the entry settings drawer (`xs`) uses it,
  and `src/test/conventions.test.ts` enforces both the pairing and that single use.
- `Alert` variants: `default`, `destructive`, `warning`, `info`, `success` (tinted status surfaces; light `info` is a neutral
  `muted` note with a cobalt icon).
- `Card`: 12px radius, border, no shadow, 20px padding. Prefer `Panel` in screens.
- `Badge` variants: `secondary` (default) and `outline`, for neutral labels only (Default, Built-in,
  You, roles, kinds, counts). State is a `StatusChip`.
- Sidebar `SidebarMenuButton` gained `variant="nav"` / `size="nav"` (the main navigation's 40px rows);
  only the Shell uses them.
- Overlays, menus, popovers, tooltips and toasts are on the tokens; toasts sit above the status bar.

### Brand

**`Logo`** `{ variant?: 'default' | 'reverse'; className? }`
The mark, decorative (`aria-hidden`), 32px by default. `default`: the acid-yellow rounded tile (`brand-logo`,
`#E9F26E`) with a plum S (`brand-logo-foreground`, `#231527`), in every theme, light and dark. On dark grounds
the S stays plum, never white: the S is a cut-out in the source, so the mark always draws its plum backing
underneath. `reverse`: for the auth brand panel, the tile in `brand-panel-mark` with the same plum S drawn
underneath (no cut-out), so the mark reads the same on every panel colour. Geometry from `src/assets/brand/mark.svg` (`Logo/paths.ts`).

**`Wordmark`** `{ size?: 'default' | 'sm' | 'lg'; variant?: 'default' | 'reverse'; className? }`: the logo,
mark + the outlined "shapio" letters (`src/assets/brand/wordmark.svg`, `Wordmark/letters.ts`), announced as
"Shapio". Mark and letters share one height so the lockup keeps the logo's proportions: `default` 36px
(sidebar, the auth screens' compact header; the collapsed sidebar shows the mark alone at 32px), `sm` 24px
(status bar, phone bar), `lg` 52px (auth brand panel, with `variant="reverse"`). The letters take
`currentColor` from `brand-letters`: plum `#231527` on light grounds, cream `#F5EBD8` on dark ones (`reverse`:
the panel's text colour). They carry `data-slot="wordmark-letters"`, which the collapsed sidebar hides to show
the mark alone. Never set "shapio" as text for the brand.

Brand files live in `src/assets/brand/` (`mark.svg`, `wordmark.svg`, `logo-horizontal.svg`, generated by
`node brand/build.mjs` in the Shapio palette; the letters are `currentColor`, plum by default and cream under a
dark colour scheme). The original blue logo is kept in the repo-root `brand/` as `classic-*` and is not used by
the admin; the Classic UI theme shows the Shapio logo too. `pnpm --filter @shapio/admin brand:icons` regenerates
`public/favicon.svg`, `favicon-32.png` and `apple-touch-icon.png` (plum S on full-bleed yellow) from
`mark.svg`; `Logo/brandAssets.test.ts` keeps the components, the files, the favicon and the `classic-*` set on
the same geometry.

**`BrandMessage`** `{ title; description; actions; className? }`
A whole-screen message on brand (not found, a route that failed): mark, title, one line, actions.

### Hooks

- `useSaveShortcut(onSave, enabled)` (`src/hooks`): Mod+S runs `onSave` instead of the browser's "save
  page". The entry form saves with it; the model builder opens its review.
- `useDiscardGuard({ dirty, pending?, onOpenChange })` → `{ requestOpenChange, discardPrompt }`: dirty-close
  protection for a sheet that isn't a `FormSheet` (an entry form in a sheet, media details). Pass
  `requestOpenChange` to the sheet (and to its Cancel) and render `discardPrompt` beside it.

### Formatting helpers

- `formatDateTime(iso)`: full date and time.
- `formatRelativeTime(iso)`: "2 hr. ago", "yesterday", "in 3 days" for list columns; put the full
  `formatDateTime` in the cell's `title`.
- `describedBy(...ids)`: joins `aria-describedby` ids, skipping empty ones.

## Patterns

How the editor-facing screens are put together. Each pattern names what it is made of and the rules that
keep it consistent; components are listed in the catalogue once they exist.

### Document

An entry opens as a document, not a form. Top to bottom:

1. **Top bar** (thin, sticky): breadcrumb (place / title), `StatusChip`, save state, presence avatars,
   Preview, Settings, Publish (primary, last). No side panel.
2. **Cover** (the model's cover field, a single image): full width, with Replace / Focal point / Remove on
   hover; dropping a file replaces it. Empty: a dashed "Add a cover" band.
3. **Title** (the model's title field): one line, `text-display`, no border, no label. Only string/text
   titles are editable here; any other type shows read-only and is edited as a property.
4. **Properties strip**: chips for the strip fields (default: the first five non-empty properties). Click
   a chip to edit in place: a popover for relations, dates and choices, inline text for strings.
   "+N more" opens the settings drawer. Localized or shared is a small icon on the chip, never a text
   badge.
5. **Canvas**: the canvas fields in order, as one writing surface (see below).

**Block or property.** Rich text, dynamic zones, repeatable components and multiple media are canvas
fields; they render as blocks. Everything else (strings, numbers, dates, choices, relations, a single
component, booleans) is a property: a chip in the strip, a row in the drawer. The model's Display settings
choose which fields go where; `effectiveLayout` in `@shapio/schema` supplies the defaults and is the only
source the admin reads.

**Canvas fields own their blocks.** The canvas is a sequence of fields; each one owns its blocks and
stores them in its own format. A block never moves from one field to another. Between two fields a subtle
divider shows the next field's label on hover, so people know where Body ends and Sections begin; never a
form label above a block.

- Rich text: `font-serif text-canvas`, a floating formatting toolbar on selection, a hover handle for drag
  and the block menu, images by drop or from the library, captions. The drag handle is the canvas's own;
  the admin ships no collaboration dependencies (no Yjs).
- Zone and list items: one block per item with a compact header (component name, item title; move,
  duplicate, delete on hover), its fields laid out as label and value lines, collapsed when long.
- Multiple media: a gallery block.
- Custom editors render inside the same block chrome with their label.

**The `+` menu rule.** `+` and `/` offer only what can be stored at the insertion point: rich-text block
types inside a rich-text field; the field's allowed components between zone or list items and at the
field's end; both at a boundary between the two. Nothing is offered that the save would reject.

**Settings drawer** (right, 360px, non-blocking: the document stays interactive): Status (current state,
live since, locales with "Start French"), Properties (all non-canvas fields as compact rows that expand to
their editor), Cover (alt text, focal point), History, Danger (unpublish, delete via `InlineConfirm`).
Esc closes it.

**Publish pre-flight.** Publish opens a checklist anchored to the button, one plain sentence per check
with a fix link that takes you to the spot: required field empty, alt text missing, locale not started,
slug already used, broken relation, validation issues. Errors disable Publish now; warnings are
information. Actions: Schedule…, Not yet, Publish now. Sentences come from translations, built
from the check's rule and params.

**Property-only models** (no canvas fields, e.g. Author): cover, title, then a two-column grid of compact
editors. Still a document: no labels stacked above inputs.

Keyboard: Mod+S save, Mod+Shift+P publish, Mod+/ drawer, Mod+Shift+L next locale, Mod+K palette (the
rich-text link shortcut is Mod+Shift+K), `/` block menu, Alt+↑/↓ move a block, Esc closes the drawer.

### Place

A content type is a place (Articles, Authors). The word "Models" never appears to editors.

- **Header**: `PageHeader` with the place name, count in `meta`, locale, New (primary). Tabs: Entries, and
  Structure / API with the schema permission. Display settings are a section inside Structure.
- **List**: title (bold link), author avatar, `StatusChip`, updated (relative, full date in `title`),
  locale flags for localized models, presence avatars for entries open right now. Hover (and focus)
  reveals quick actions: Edit, Preview, Publish/Unpublish, Duplicate, Delete (`InlineConfirm`). Filters
  are chips (status, author, locale, relation), with search, sort, the column chooser and the bulk bar.
- **Quick edit** expands a row in place to edit its properties without opening the document. One row at a
  time; Esc collapses it; dirty rows ask before collapsing.
- **Cards**: a view toggle for models with a cover, as gallery tiles (cover, title, status).
- Singletons skip the list: Entries shows the document directly, tabs kept.

### Presence

Who else has this entry open. Information only: entries lock nothing, and conflicts stay with the
version guard.

- Avatars (initials, 24px, overlapping, "+N" past three) in the document's top bar, smaller on list rows.
  Each has an accessible name ("Ana is editing") and a tooltip with the locale and since when.
- The editor sends a heartbeat every 15 seconds while the tab is visible and leaves on close; someone
  disappears after 45 seconds without one. No spinners, no toasts when people come and go.

### Inbox

Home for everyone: what needs you, then what's coming and what just happened.

- **Needs you**: health findings grouped by rule, each a one-line sentence ("2 images in _Spring launch_
  have no alt text") with a fix action that opens the entry at the right spot. Warnings and errors use
  `StatusChip` tones; nothing is red unless it blocks publishing.
- **Scheduled soon** and **Recently published**: short lists linking to the documents.
- The dashboard is a section below, only for people who manage publishing or users.
- Empty: an `EmptyState` that says everything is in order, no action needed.

### Command palette

The ⌘K palette (`components/CommandPalette`) is the one allowed centred overlay: a transient launcher (go
to, search entries and media, create, actions on the current page) that never holds a form or unsaved
input. It opens with ⌘K/Ctrl+K or the sidebar's Search button, is a modal dialog with a combobox and a
grouped listbox (↑↓, Enter, Esc, focus returns where it was), and screens add their actions with
`usePaletteActions(memoizedActions)`.

## Dialogs

No centred dialogs for creating, editing, picking or routine confirmation. Sheets are still modal for
assistive technology (focus trap, inert dimmed page), which keeps keyboard, screen-reader behaviour and
the dirty-close guard working. The one exception is the document's settings drawer: non-modal, so the
document stays interactive beside it (see Patterns → Document).

| Need                                                            | Pattern                                                               | Component                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| Create or edit a record from a list                             | right-hand sheet (sm 400 / md 560 / lg 720); the list stays visible   | `FormSheet`                     |
| Create something with its own URL (a model)                     | a page                                                                | `Page` + `PageHeader`           |
| Add an item inside an editor (a field)                          | inline, in the editor's own pane                                      | feature-local                   |
| Pick something                                                  | sheet for browsing (media, entries), popover for a short list or tree | `Sheet`, `Popover`              |
| Review before a risky save (schema plan)                        | sheet `lg`, so the thing being changed stays in view                  | `Sheet`                         |
| Confirm a routine destructive or consequential action           | inline confirm anchored to the trigger (or to the row's menu button)  | `InlineConfirm`                 |
| Show a one-time secret                                          | inline panel at the top of the page where it was created              | `SecretReveal`                  |
| Notice after an action (other locales, remote change, conflict) | banner in place (`Alert`) or a toast with an action                   | `Alert`, `toast(…, { action })` |
| Irreversible acknowledgement                                    | blocking dialog, the only kind left                                   | `ConfirmDialog`                 |
| Go anywhere, run a command                                      | the command palette, the one centred overlay (see Patterns)           | `CommandPalette`                |

`ConfirmDialog` is kept only for: leaving with unsaved changes (`UnsavedChangesGuard`, `useDiscardGuard`),
deleting a model, force-deleting a file that content uses, deleting a locale that has content, changing the
default locale, deleting an admin role. `src/test/conventions.test.ts` checks that `ui/dialog` isn't used
and that `AlertDialogContent` appears only in `ConfirmDialog`.

## Do and don't

- Do restyle through a component's props and variants. If a shared component can't express what a
  screen needs, ask for a variant; don't override it from outside with `className` colour or spacing
  hacks, and don't fork it inside a feature.
- Do check both themes and phone width (390px) before reporting.
- Do use `StatusChip` for state, `Badge` only for neutral labels (Built-in, a count).
- Don't add a header bar, page gutter or background in a screen: the Shell owns them.
- Don't hardcode text: `translation.json`, under your feature's scope.

## Tests and evidence

- Unit: `src/test/contrast.test.ts`, `src/test/conventions.test.ts`, `src/test/translations.test.ts`,
  `src/helpers/cn.test.ts`, and component tests next to their component.
- Keyboard-only e2e is split by area: `keyboardContent`, `keyboardModels`, `keyboardMedia` (shared setup
  in `e2e/support/keyboardSuite.ts`). Locale management is `locales.spec.ts`.
- e2e: build and run through `pnpm --filter @shapio/admin e2e:locked [playwright args]` (a lock in
  `e2e/.artifacts/` serializes builds and runs in the shared tree). `captureScreen(page, name,
{ viewports: ['desktop', 'phone'] })` captures 1440×900 and 390×844 in both themes with axe. Redesign
  captures go to `docs/acceptance-evidence/redesign/` via `SHAPIO_E2E_SCREENSHOTS` (absolute path).
- `admin*.spec.ts` run in name order: `admin1Setup` (first run, W5), `admin2Shell` (shell, W0),
  `admin3Team` (users and settings, W4), `admin4Auth` (sign-in, invitation, reset, not found, W5).
