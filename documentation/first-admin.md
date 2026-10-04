# First admin

Shapio ships with no default account and no default password.

## The Setup screen

While no admin account exists, every start logs one line saying where to go:

```text
No admin account yet. Open https://cms.example.com/admin/ to create the owner account.
```

Open `/admin/`; it sends you to the Setup screen. Enter your name, email and a password (at least 12
characters). That creates the first **owner** and signs you in.

- The first person to complete Setup becomes the owner, as with WordPress, Ghost or Strapi. Two people
  submitting at the same moment cannot both succeed: exactly one owner is created.
- As soon as any admin exists, setup is closed for good.
- Until then, anyone who can reach the server can claim it. Complete Setup right after the first start, or
  use one of the options below if the server is reachable by others before you get there.

## Requiring a setup token (`SETUP_REQUIRE_TOKEN`)

For an install that is exposed to the internet before setup, set `SETUP_REQUIRE_TOKEN=true`. Every start
before setup then issues a one-time setup token and writes it to the log once:

```text
========================================================================
No admin account exists yet. Open https://cms.example.com/admin/setup and enter this one-time setup token
(or run `shapio admin create`):

  One-time setup token: …

========================================================================
```

The Setup screen asks for the token as well.

- The token works once. As soon as any admin exists, setup is closed for good.
- Only a hash of the token is stored. Restarting before setup issues a new token and invalidates the old one.
- Find it with `pm2 logs`, `journalctl -u shapio` or `docker compose logs shapio`. In production the log is
  JSON lines; the token is in the `msg` field, e.g. `docker compose logs shapio | grep -oE 'setup token: [A-Za-z0-9_-]{43}'`.

## Without the browser: `shapio admin create`

On the server (it talks to the database directly):

```sh
SHAPIO_ADMIN_PASSWORD='a long passphrase here' npx shapio admin create --email you@example.com --name "Your Name"
```

Without `SHAPIO_ADMIN_PASSWORD` a strong password is generated and printed once. `--role` picks another
built-in or custom role by its key (default `owner`; the built-in keys are `owner`, `admin`, `editor` and
`read-only`). It needs the migrations applied (`npx shapio migrate`, or start the
server once). Creating the owner this way closes Setup before anyone else can reach it.

## Roles

| Role      | Can                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------- |
| Owner     | everything, including managing other owners                                                         |
| Admin     | everything except granting or removing the owner role                                               |
| Editor    | create, edit, publish and delete content in every model; upload media; change sets; trigger deploys |
| Read-only | read content and media                                                                              |

Custom roles (Network → Roles) grant actions per model (`read`, `create`, `update`, `delete`, `publish`,
`schemaManage`), optionally per field, plus instance-wide permissions (`schema.create`, `users.manage`,
`roles.manage`, `tokens.manage`, `audit.read`, `media.*`, `publishing.manage`, `webhooks.manage`,
`deployments.manage`, `deployments.trigger`, `changes.manage`, `changes.ship`). Everything is denied unless a
role grants it. `changes.manage` covers preparing change sets, snapshots and restore; `changes.ship` covers
shipping and scheduling them; the field-usage report needs `tokens.manage`.

On an instance with several [sites](sites.md#permissions-and-assignments), a role is assigned on one site or on
all sites. `schema.create`, `users.manage`, `roles.manage`, `audit.read`, `sites.manage` and `schemaManage` are
network permissions: only roles held on all sites grant them. The Owner role is always held on all sites.

## Your team

Network → Users → **Invite user** sends an invitation link (valid 7 days) by email. Each person has one role per
site, or one role on all sites; Editor on all sites is preselected. With a single site the form is just the role.
With several, it lists **Access** rows of a site (or _All sites_) and a role, one row per site. The Owner role
isn't offered when inviting: invite them with another role, then an owner can give them Owner on all sites from
the user's row (**Change access**). Password reset emails work the same way (links valid one hour).

### Inviting people without email

Until you configure SMTP (`EMAIL_TRANSPORT=smtp`, see [environment variables](reference/environment.md#email)),
Shapio can't send email: messages are written to the server log instead. You don't need the log to invite
someone, though. Right after you invite them, the Users screen shows their **invitation link** once, with a
copy button. Send it to them yourself (chat, your own email).

- **Copy link** on a pending invitation creates a new link at any time. The earlier link stops working, the
  emailed one included, so only the latest link you shared can be used.
- With SMTP configured, the invitation is emailed as usual, and the "Invitation sent" notice also offers
  **Copy link**.
- Links are never stored: Shapio keeps only a hash, so a lost link can't be shown again. Create a new one.
- Creating a link needs the `users.manage` permission and is recorded in the audit log.

## API tokens

Settings → API tokens creates a token bound to one role. It is shown once; Shapio stores only its hash.

- An **admin** token (bound to an admin role) is what `shapio schema`, `shapio export`, `shapio import` and
  `shapio types` use: `--token shp_…` or `SHAPIO_TOKEN`.
- A **delivery** token (bound to a delivery role, which can only grant `read`) is what your site's build uses
  to read published content. See [Delivery API](delivery-api.md#tokens).

Tokens belong to the site they are created on. An admin with `users.manage` can instead create a **network**
admin token, which works on every site ([Sites](sites.md#api-tokens)).

Sessions, rate limits and the audit log: [Security](security.md).

## Appearance

Each person picks how the admin looks, from the account menu (**Theme**) or Settings → **Appearance**; the
signed-out screens have the same menu behind the palette button. There are two choices:

- **Theme**: **Shapio** (plum, cream and acid yellow; the default), **Classic** (the original cobalt look),
  **Murdered out** (blacked out) and **Snowed** (white and ice blue). A project can add its own themes
  ([Extensions: admin themes](extensions.md#admin-themes)); they are listed after these.
- **Colour mode**: System (follows your operating system), Light or Dark. The sun/moon button beside the
  account menu switches between light and dark in one click.

Murdered out has a dark version only and Snowed a light version only: with them the colour mode does nothing
(it is greyed out, and the one-click switch says why). Your colour mode is kept for when you pick another theme.

The choice is saved in this browser only, not in your account: another browser or device starts with Shapio,
following the operating system. It is applied before the page first paints, so there is no flash on load.
