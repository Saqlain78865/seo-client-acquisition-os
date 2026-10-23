# Security

This file has two parts:
- the protections in the app, each with where it is implemented and how it is tested;
- the review done in Phase 6 and the limitations that remain.

## Accounts and sessions

- **Passwords**
  - Hashed with bcrypt (cost 12). At least 10 characters, with a letter and a number.
  - When an email does not exist, the login still compares against a dummy hash, so response time does not reveal whether an account exists.
- **Login rate limiting**
  - 5 failed attempts per email or 20 per IP address within 15 minutes pauses login.
  - Implementation: `src/lib/auth.ts`.
- **Sessions**
  - 256-bit random token in an `httpOnly`, `SameSite=Lax` cookie, which is also `Secure` in production.
  - The database stores only a SHA-256 hash of the token. Sessions expire after 14 days and are deleted on sign-out.
  - Changing a password signs out every other device. Users can also do this themselves under **Account & Team**.
- **Registration** is open only until the first account exists. After that, owners add people with a role:
  - **owner**: everything, including team, export and clean-up;
  - **admin**: settings, integrations, System page, deleting records;
  - **member**: CRM, audits, proposals.
- **Owner protections**
  - The last owner cannot be removed or demoted, and nobody can change their own role.
  - Removing a member ends their sessions in that workspace immediately.

## Authorisation and data isolation

- **Workspace checks**
  - Every page, server action and route handler loads the session from the database.
  - Every query is filtered by the session's workspace, so an id from another workspace gives "not found".
- **The proxy** (`src/proxy.ts`) only redirects people who have no cookie. Real checks happen on the server.
- **Role checks** run on the server (`requireRole`). Hidden buttons are a convenience, not the protection.
- **Tests:** e2e tests confirm that signed-out requests to private routes get 401 or a redirect, and that a member gets 403 from the export.

## Secrets

- **Integration credentials at rest:** App Passwords, SMTP passwords, OAuth refresh tokens, WhatsApp tokens and API keys are encrypted with AES-256-GCM using `ENCRYPTION_KEY` (`src/lib/crypto.ts`).
- **On use:** they are decrypted only on the server, at the moment they are used. They are never sent to the browser or shown again.
- **Before saving:** credentials are tested with the provider first, so a wrong password is never stored as "connected".
- **Logs:** the logger (`src/lib/log.ts`) removes any field named like a password, token, secret, key, cookie or authorization. It also masks Google API keys, OAuth access tokens, Bearer/Basic headers and `key=` / `token=` URL parameters inside messages.
- **Export:** the workspace export leaves out password hashes, session tokens, encrypted credentials, share-link tokens and storage paths. A test checks this.
- **Git:** `.env`, databases, `storage`, `backups` and test storage folders are listed in `.gitignore`.

## Crawler (SSRF protection)

Audits fetch URLs typed by users. To stop that being used against internal networks
(`src/lib/crawler/network-guard.ts`, `safe-fetch.ts`):

- **URL shape:**
  - only http(s);
  - no usernames or passwords in the URL;
  - standard ports only;
  - `localhost`, `.local` and `.internal` hostnames, including with a trailing dot, are refused.
- **Every connection:**
  - The hostname is resolved and **each** IP address is checked; private, loopback, link-local, CGNAT, multicast and reserved ranges are refused, for IPv4 and IPv6.
  - The check happens in the socket's DNS lookup, so DNS rebinding between check and connect does not work.
- **Redirects:** followed manually, and each hop is checked again.
- **Limits:** response size, timeouts, and robots.txt is respected.
- **JavaScript rendering:** headless Chromium runs every request it makes through the same public-address check, so a page cannot make the renderer reach a private or internal host. Images, media and fonts are not downloaded at all.

## Web security

- **Headers** (`next.config.ts`):
  - Content-Security-Policy:
    - default `'self'`, no plugins (`object-src 'none'`);
    - `frame-ancestors 'self'`, `form-action 'self'`, `base-uri 'self'`.
  - HSTS in production.
  - X-Frame-Options, `nosniff`, Referrer-Policy, Permissions-Policy.
  - Cross-Origin-Opener-Policy.
- **Proposal HTML:**
  - The preview and the public share view are served with their own stricter CSP: no scripts at all (`default-src 'none'`).
  - All proposal text is HTML-escaped. Only http(s) links are produced; `javascript:` and `data:` links become plain text.
- **CSRF:**
  - Server actions are origin-checked by Next.js.
  - The CSV upload route checks `Origin` itself.
  - The session cookie is `SameSite=Lax`.
  - Google sign-in uses a random `state` value stored in an httpOnly cookie and compared in constant time.
- **Uploads:**
  - Logos are accepted by file signature (PNG, JPEG or WebP; SVG is refused), up to 1 MB.
  - CSV imports are limited to 8 MB.
  - Stored files live outside `public/` under app-generated names. Storage keys are validated against path traversal.
- **CSV export** neutralises spreadsheet formula injection.
- **Share links:**
  - 192-bit random tokens with an expiry; they can be revoked.
  - Marked `noindex`. The proposal document itself is served with `Referrer-Policy: no-referrer`.
  - They show only the locked version they were created for.
- **WhatsApp webhooks** are accepted only with a valid `X-Hub-Signature-256` from the matching app secret.

## Outreach safety

- **No sending without consent:** nothing is sent without a person clicking **Send** and confirming. Follow-ups are reminders only.
- **Unverified recipients:** addresses or numbers found by the crawler must be confirmed before sending.
- **Opt-out:** opted-out prospects are blocked from email and WhatsApp.
- **Duplicate sends:** sending is idempotent, so a double click or a retry cannot send twice.
- **WhatsApp channels:** only official options, i.e. click-to-chat (the user sends it) or Meta's Cloud API. There is no WhatsApp Web automation.

## Phase 6 review: what was checked

- **Code review**
  - All 11 route handlers and every server action file were reviewed for session, role and workspace checks.
  - XSS sinks were reviewed: one `dangerouslySetInnerHTML`, which is a static theme script, plus the proposal renderer.
  - Redirect targets were reviewed; there are no open redirects.
  - Logging of secrets was reviewed.
- **Changes made after the review**
  - The CSP and HSTS headers were added.
  - The import route got its `Origin` check.
  - Structured logs with secret redaction and request ids were added.
  - Password change, team management and other-device sign-out were added; before this there was no way to add a team member or change a password.
  - Account recovery from the server was added: `npm run reset-password`.
  - The retention sweep now deletes files of deleted records. It only touches workspaces that exist in the current database, so a wrong `DATABASE_URL` cannot wipe the storage folder.
- **Dependencies**
  - `npm audit --omit=dev`: **0 vulnerabilities** in production dependencies.
  - `npm audit` reports 5 "high" findings, all in the ESLint toolchain: `braces` through `eslint-config-next`. They run only on a developer's machine when linting, and are not part of the server. The proposed "fix" downgrades `eslint-config-next` to v14, which does not support this Next.js version, so it was not applied.

## Known limitations

- **CSP:** `script-src` includes `'unsafe-inline'`, which Next.js needs for its inline bootstrap scripts without nonces. The CSP still blocks scripts from other origins, but it is not a complete defence against XSS. The escaping above is the main protection.
- **No two-factor login** and **no email "forgot password"**. Recovery is through `npm run reset-password` on the server.
- **Single instance:** rate limiting and the job worker assume one server process. Running several instances needs a shared queue and shared rate limiting.
- **Gmail App Password:** gives full access to that Gmail account. A dedicated sending account, or Gmail via Google sign-in (which uses a narrower `gmail.compose` scope), is safer.
- **`ENCRYPTION_KEY`:** anyone with this key and the database can read the stored credentials. Keep it only in `.env` and a password manager.
