# Troubleshooting

Start with **System** in the sidebar (owners and admins). It runs live checks of the database,
encryption key, app URL, file storage, PDF engine and background worker, and it lists failed jobs.

When an error message ends with **(Reference: 1a2b3c4d)**, search the server logs for those 8
characters. The matching line has the full technical detail. Secrets are never written to the logs.

## Setup and starting

**`npm : The term 'npm' is not recognized` (Cursor terminal)**
Cursor was open before Node.js was installed, so its terminal has the old PATH. Close Cursor
completely, including from the system tray, and open it again. As a one-off fix in the current
terminal:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
```

**`EPERM: operation not permitted` on `.next` during `npm run build`**
OneDrive is syncing the folder. Pause OneDrive syncing, delete `.next`, and build again. Better: move
the project outside OneDrive, for example to `C:\Projects`.

**"ENCRYPTION_KEY is not set" or "must be 32 bytes"**
Generate a key and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

If you **changed** an existing key, the saved integration credentials can no longer be read.
Connect them again on the Integrations page.

**"PDF engine is not installed" or System shows "Chromium is not installed"**
Install Chromium:

```bash
npx playwright install chromium
```

On Linux, run `sudo npx playwright install-deps chromium` first.

## Signing in

**"Too many failed attempts. Please wait 15 minutes"**
After 5 failed attempts for one email, or 20 from one IP address, login pauses for 15 minutes. That
is the protection working. Wait, or reset the password as described below; a reset also clears the
lock.

**Forgot password / locked out owner**
On the machine that runs the app, in the project folder:

```bash
npm run reset-password -- you@example.com "NewPassword123"
```

This signs the person out everywhere. Ask them to change it on **Account & Team** afterwards.

**A team member cannot sign in**
- Check that they appear under **Account & Team**.
- Someone removed from every workspace gets "Incorrect email or password".

## Audits

**"The domain … could not be found"** — check the spelling. The site must resolve in public DNS.

**"This URL cannot be audited"** — private, local and non-standard-port addresses are blocked on
purpose, to protect against server-side request forgery (SSRF).

**Audit FAILED or PARTIAL** — open the audit; each stage shows its own message. Common causes:
- The site blocks bots: HTTP 403 or 429.
- robots.txt disallows the pages.
- The server timed out.

Use **Retry** on the audit page, or **System → Failed → Retry**. Completed stages are kept.

**An audit stays "Queued"** — the worker starts when someone opens the app after a restart. Open any
page. If it still waits, **System → Background worker** shows how long the job has waited, and
the logs show why (`"scope":"jobs"`).

## Integrations

**Gmail: "Username and Password not accepted"**
- Use an **App Password**, not your normal Gmail password.
- App Passwords need 2-Step Verification. Create one at https://myaccount.google.com/apppasswords.
- Paste the 16 letters with or without spaces.
- Google Workspace accounts: the administrator may have disabled App Passwords. Use "Gmail via Google sign-in" or SMTP instead.

**Gmail via Google sign-in shows "Not available until GOOGLE_CLIENT_ID…"**
This needs your own OAuth client:

1. In Google Cloud Console, open **APIs & Services → Credentials** and create an OAuth client of type "Web application".
2. Set the redirect URI to `<APP_URL>/api/integrations/google/callback`.
3. Enable the Gmail API.
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, then restart the app.

**Gemini: "Gemini API has not been used in project … or it is disabled"**
The key belongs to a Google Cloud project where the *Generative Language API* is switched off. Fix
it one of these ways:
- Create the key at https://aistudio.google.com/apikey, which enables the API automatically.
- Open the link in the error message and click **Enable**, then wait a few minutes.

**PageSpeed: "quota reached" (HTTP 429)**
No key is set, and Google's shared keyless quota is used up. Add a free PageSpeed key (25,000
tests per day) on the Integrations page, or set `PAGESPEED_API_KEY` in `.env`.

**WhatsApp Cloud API errors**
The send screen shows Meta's error with a recovery step. The most common ones:

| Error | Meaning | Fix |
|---|---|---|
| Token expired (code 190) | The access token is no longer valid | Create a *permanent* System User token in Meta Business Settings |
| Outside the 24-hour window (131047) | Free-form messages need a recent reply from the client | Use an approved template |
| Template does not exist (132001) | Name or language does not match | Check the exact name and language in WhatsApp Manager |

**WhatsApp click-to-chat does not open**
- The number must be in international format, e.g. `+92 300 1234567`.
- WhatsApp Web or the app must be installed or signed in on that device.

## Proposals and share links

**Share link or QR code opens "localhost" or the wrong address**
`APP_URL` in `.env` is wrong. Set it to the public HTTPS address and restart. Links created
earlier keep their old address, so create a new link.

**"This link is not available"** — the link expired or was revoked. Create a new one from the proposal page.

**"The stored PDF for this sent version is missing"** — the file was deleted from `STORAGE_DIR`.
Sent versions are never re-rendered, so that the client's copy stays exactly what was sent.
Restore the `storage` folder from a backup.

## Data

**Export everything** — **System → Download export** (owners). This is a JSON file without
passwords, tokens or credentials.

**Restore from backup** — see docs/DEPLOYMENT.md → Backups.
