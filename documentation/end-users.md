# End users

Besides editors, Shapio has accounts for the **end users of your sites and apps**: members, customers,
players. They sign up and sign in through `/api/app-auth`, and read or write content through the
[delivery API](delivery-api.md) under roles you define, including "only their own entries". Admin accounts and
app users are separate: an app user can never reach the admin.

## Access is denied until you allow it

| Role             | Who holds it                                         | Starts with    |
| ---------------- | ---------------------------------------------------- | -------------- |
| `public`         | every anonymous request (no token)                   | no permissions |
| `authenticated`  | every signed-in app user                             | no permissions |
| custom app roles | the app users you assign them to (Users → App users) | what you grant |

Settings → Roles → App roles sets each role's grants per model: `read`, `create`, `update`, `delete`, `publish`, each
optionally limited to **own entries** (`ownedByPrincipal`) and to some fields. "Read on all models" is one
click for `public` or `authenticated`. App users see `public` fields only, unless a grant names hidden ones.

## Sign-up and sign-in

```sh
curl -X POST "$SHAPIO_URL/api/app-auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"a long passphrase","name":"Ada"}'
```

The answer (`201`) has the user and a session. When email confirmation is required it is `202` with
`{ "confirmationRequired": true }` instead (see [below](#email-confirmation-and-password-reset)). Abbreviated:

```json
{
  "confirmationRequired": false,
  "user": {
    "id": "…",
    "email": "ada@example.com",
    "name": "Ada",
    "confirmed": false,
    "hasPassword": true,
    "providers": []
  },
  "session": {
    "accessToken": "eyJ…",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "refreshToken": "…",
    "refreshTokenExpiresAt": "2026-11-01T10:00:00.000Z"
  }
}
```

- `POST /api/app-auth/login` `{ email, password }` returns a session.
- Send `Authorization: Bearer <accessToken>` with API requests. Access tokens live 15 minutes
  (`APP_AUTH_ACCESS_TOKEN_TTL_SECONDS`).
- `POST /api/app-auth/refresh` `{ refreshToken }` returns a new session. Refresh tokens rotate on every use and
  last 30 days (`APP_AUTH_REFRESH_TOKEN_TTL_DAYS`). Presenting an already-used refresh token revokes that whole
  login (a stolen token is detected) and is recorded in the audit log.
- `POST /api/app-auth/logout` `{ refreshToken }` **signs the account out on every device**: it ends this
  login, and every access token the account holds, on any device, is refused from the next request (`GET
/api/app-auth/me` then answers 401). The account's other logins keep their refresh tokens, so they get a new
  access token on their next refresh; your app should refresh on a 401.
- `GET`/`PATCH /api/app-auth/me`, `POST /api/app-auth/me/password`, `DELETE /api/app-auth/me` manage the account.

Logging out, changing or resetting the password, and blocking or deleting the account reject the access
tokens already issued on their next request, not when they expire. Changing a user's roles in the admin also
takes effect on their next request.
Passwords are hashed with argon2id; sign-in is rate limited per IP and, for failed attempts, per account and IP; reset requests per IP and per email.

`@shapio/client` wraps these endpoints (`createClient({ baseUrl }).appAuth`).

## Email confirmation and password reset

Shapio emails links that point at **pages on your site**, which read the token from the URL fragment
(`#token=…`) and post it back:

```dotenv
APP_AUTH_CONFIRM_EMAIL_URL=https://www.example.com/confirm-email
APP_AUTH_RESET_PASSWORD_URL=https://www.example.com/reset-password
# Require a confirmed email before sign-in:
APP_AUTH_REQUIRE_EMAIL_CONFIRMATION=true
```

- Confirm: your page `POST`s `{ token }` to `/api/app-auth/confirm-email`. Resend with
  `POST /api/app-auth/confirm-email/resend { email }`.
- With `APP_AUTH_REQUIRE_EMAIL_CONFIRMATION=true`, sign-up always answers `202 { "confirmationRequired": true }`
  ("check your email"), whether or not the address already has an account, so sign-up cannot be used to find
  out who is registered. For a taken address nothing is created or changed (the password in the request is
  discarded); the owner gets an email saying someone tried to sign up with it. Your sign-up page therefore
  cannot tell the user "this address is taken"; it should always say "check your email". Without required
  confirmation, a taken address answers `409 EMAIL_TAKEN` (sign-in is immediate, so the answer has to differ;
  per-IP and per-email rate limits slow down address probing).
- Reset: `POST /api/app-auth/password-reset { email }` (always answers 202, so it reveals nothing), then your
  page `POST`s `{ token, password }` to `/api/app-auth/password-reset/confirm`.

Emails need SMTP ([environment variables](reference/environment.md#email)); without it they go to the log.

## Google and GitHub sign-in

1. Create an OAuth client with the provider, with this callback URL:
   - Google (Google Cloud Console → APIs & Services → Credentials → _OAuth client ID_, type _Web application_):
     `{PUBLIC_URL}{BASE_PATH}/api/app-auth/oauth/google/callback`
   - GitHub (Settings → Developer settings → OAuth Apps → _New OAuth App_, "Authorization callback URL"):
     `{PUBLIC_URL}{BASE_PATH}/api/app-auth/oauth/github/callback`
2. Configure Shapio and restart:

   ```dotenv
   APP_AUTH_GOOGLE_CLIENT_ID=…
   APP_AUTH_GOOGLE_CLIENT_SECRET=…
   APP_AUTH_GITHUB_CLIENT_ID=…
   APP_AUTH_GITHUB_CLIENT_SECRET=…
   # Where sign-in may return to (exact origins, or custom-scheme prefixes for native apps).
   # Default: the origins in CORS_ORIGINS plus PUBLIC_URL's.
   APP_AUTH_RETURN_URLS=https://www.example.com,myapp://auth
   ```

3. In your app, create a PKCE pair (RFC 7636): a random `codeVerifier` (43–128 characters of
   `A–Z a–z 0–9 - . _ ~`) that you keep, for example in `sessionStorage`, and its S256 `codeChallenge`
   (base64url of its SHA-256, 43 characters). Then send the browser to
   `/api/app-auth/oauth/google/start?redirectTo=https://www.example.com/auth/done&codeChallenge=<challenge>`.
   After the provider, Shapio returns to `redirectTo` with `?code=…` (or `?error=…`).
4. Your app trades the one-time code for a session, with the verifier:
   `POST /api/app-auth/oauth/exchange { code, codeVerifier }`. The code works once, within a minute. The
   verifier is required, and a wrong one is refused (`400 INVALID_CODE_VERIFIER`) and spends the code, so
   whoever intercepts the redirect (a malicious app registered for the same custom scheme, a leaked URL)
   cannot use it; your app then starts the sign-in again.

With `@shapio/client`:

```ts
import { createClient, createPkcePair } from '@shapio/client';

const shapio = createClient({ baseUrl: 'https://cms.example.com' });

// Starting the sign-in:
const { codeVerifier, codeChallenge } = await createPkcePair();
sessionStorage.setItem('shapio-pkce', codeVerifier);
location.assign(shapio.appAuth.oauthStartUrl('google', 'https://www.example.com/auth/done', codeChallenge));

// On https://www.example.com/auth/done:
const code = new URL(location.href).searchParams.get('code');
const session = await shapio.appAuth.exchangeCode(code!, sessionStorage.getItem('shapio-pkce')!);
```

`GET /api/app-auth/providers` lists the configured providers. Shapio uses PKCE with the provider as well and a
signed state cookie, and never links or creates accounts from an email address the provider has not verified.

## Writing content as an app user

With a grant such as `create` on `note` and `update` (own entries) on `note` (a collection with the plural API
ID `notes`, which names its delivery route):

```sh
curl -X POST "$SHAPIO_URL/api/content/notes" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' -d '{"data":{"text":"Mine"}}'
curl -X PUT "$SHAPIO_URL/api/content/notes/<id>" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' -d '{"expectedVersion":1,"data":{"text":"Still mine"}}'
```

The owner is set by the server from the token, never from the request. An update or delete of someone else's
entry under an own-entries grant answers 404, as if it did not exist. App users' writes are drafts, except in
models without drafts, where they are published at once; a create with `"publish": true` publishes at once
when the role also grants `publish` on the model. The same server validation applies as in the admin.
