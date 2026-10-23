# Deployment

## What the app needs from a server

The app is a **long-running Node.js server**. Serverless hosts such as Vercel or Netlify functions do
not work with it, for four reasons:

- **Background worker.** Audits run in a background worker inside the server process.
- **Chromium.** It renders JavaScript-heavy sites and creates proposal PDFs.
- **Local disk.** PDFs and logos are kept in a private folder on that disk (`STORAGE_DIR`).
- **SQLite.** The default database is a single file on that disk.

Run **one instance** only. The worker, the login rate limiting and SQLite all assume a single process.
One instance easily handles a consultant or a small agency.

| Option | Good for | Client share links |
|---|---|---|
| A. Your own Windows PC | Trying it out, working alone | Only work while the PC is on **and** reachable from the internet |
| B. Small Linux VPS (recommended) | Real use with clients | Always on, HTTPS |

## Environment variables

Put these in `.env` next to `package.json`. Never commit that file; `.gitignore` already excludes it.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `file:./prod.db` (SQLite). For PostgreSQL, see the last section. |
| `ENCRYPTION_KEY` | yes | 32 random bytes in base64. It encrypts saved integration credentials. **Back it up.** If it is lost, saved credentials must be entered again. |
| `APP_URL` | yes | The public address, e.g. `https://seo.yourdomain.com`. Used in share links, QR codes and Google sign-in. |
| `STORAGE_DIR` | recommended | Folder for PDFs and logos. Default: `./storage`. |
| `PAGESPEED_API_KEY` | recommended | Free key. A key entered on the Integrations page takes priority over this one. |
| `GEMINI_API_KEY` | optional | AI-written audit summaries. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Only for "Gmail via Google sign-in". The Gmail App Password works without them. |
| `ALLOW_REGISTRATION` | no | Leave unset. Owners add people from **Account & Team**. |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error`. |
| `DISABLE_MAINTENANCE` | no | `true` turns off the daily retention clean-up. |

Generate the encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Option A: your own Windows PC

1. Build and start the app in Cursor's terminal:

   ```powershell
   npm ci
   npx playwright install chromium
   npx prisma migrate deploy
   npm run build
   npm start          # http://localhost:3000
   ```

2. Keep the terminal open; closing it stops the app.
3. To start it automatically, install pm2 and save the process list:

   ```powershell
   npm i -g pm2
   pm2 start npm --name seo-os -- start
   pm2 save
   ```

## Option B: Linux VPS with HTTPS

These steps were written for Ubuntu 24.04 on a 2 GB RAM server (Hetzner, DigitalOcean, Contabo or
similar). Point a DNS record such as `seo.yourdomain.com` at the server first.

**1. Install Node.js and Caddy.**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs caddy
```

**2. Create a user for the app and copy the code.** Use `git clone` or copy the folder. Leave out
`node_modules`, `.next` and the `*.db` files.

```bash
sudo useradd -m -s /bin/bash seo
sudo -iu seo
cd ~/app
```

**3. Install, configure and build.** Chromium needs Linux system libraries; the `install-deps`
command installs them.

```bash
npm ci
sudo npx playwright install-deps chromium
npx playwright install chromium
cp .env.example .env && nano .env      # DATABASE_URL="file:./prod.db", ENCRYPTION_KEY, APP_URL=https://seo.yourdomain.com
npx prisma migrate deploy
npm run build
```

**4. Run the app as a service.** Create `/etc/systemd/system/seo-os.service`:

```ini
[Unit]
Description=SEO Client Acquisition OS
After=network.target

[Service]
User=seo
WorkingDirectory=/home/seo/app
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Then start it:

```bash
sudo systemctl enable --now seo-os
```

**5. Add HTTPS.** Put this in `/etc/caddy/Caddyfile`; Caddy gets a free certificate automatically:

```
seo.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then reload Caddy:

```bash
sudo systemctl reload caddy
```

**6. Check it.**

- `https://seo.yourdomain.com/api/health` returns `{"status":"ok"}`.
- Open `/register` to create the owner account.
- **System** shows every check green. "Public app URL" must be HTTPS.

**7. Open only the web ports.** The app itself listens only behind Caddy.

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

## Updating to a new version

```bash
npm run backup
git pull                  # or copy the new files over
npm ci
npx prisma migrate deploy
npm run build
sudo systemctl restart seo-os
```

Migrations only add to the schema. Back up first anyway.

## Backups

`npm run backup` writes a dated folder under `./backups/`, or under the folder you pass. The folder
contains:

- a consistent copy of the SQLite database, made with SQLite's online backup, so the app can keep running;
- the result of an integrity check of that copy;
- the `storage` folder with PDFs and logos.

Run it daily from cron (`crontab -e` as user `seo`):

```
30 2 * * * cd /home/seo/app && npm run backup -- /home/seo/backups >> /home/seo/backup.log 2>&1
```

Copy the backups somewhere off the server, for example with rclone to Google Drive. Keep
`ENCRYPTION_KEY` in a password manager: a backup cannot read the stored credentials without it.

To restore a backup:

1. Stop the app.
2. Copy `<backup>/prod.db` over your database file.
3. Copy `<backup>/storage` over `STORAGE_DIR`.
4. Start the app again.

## Monitoring and logs

- **Uptime:** point a free monitor such as UptimeRobot at `/api/health`. It returns 200 when the database answers and 503 when it does not.
- **Logs:** the server writes one JSON object per line, with `level`, `scope`, `msg`, `requestId` and `jobId`. On a VPS, read them with `journalctl -u seo-os -f`.
- **Error references:** an error shown in the app ends with `(Reference: 1a2b3c4d)`. Search the logs for that text: `journalctl -u seo-os | grep 1a2b3c4d`.
- **Secrets in logs:** passwords, tokens and API keys are redacted before a line is written.
- **System page:** health checks, failed jobs with **Retry** and **Dismiss**, a manual clean-up, and the workspace export.

## Data retention

A clean-up runs once a day, and owners can also run it from **System**. It removes:

- expired sessions;
- login attempts older than 30 days;
- finished background jobs older than 30 days;
- read notifications older than 90 days;
- PDF and logo files whose record was deleted.

Prospects, audits and proposals are only removed when you delete them. Deleting a prospect also
deletes its audits and proposals. Their PDF files are removed from disk by the next clean-up.

## PostgreSQL (optional, not tested here)

SQLite is what the app is built and tested with, and it is the recommended setup for one server.
To use PostgreSQL instead, for example a managed database:

1. Set up the PostgreSQL driver:
   - In `prisma/schema.prisma`, set `provider = "postgresql"`.
   - Run `npm i @prisma/adapter-pg pg`.
   - In `src/lib/db.ts`, replace `PrismaBetterSqlite3` with `PrismaPg({ connectionString: process.env.DATABASE_URL })`.
2. Replace the migrations:
   - Move the existing `prisma/migrations` folder away, because those migrations are SQLite SQL.
   - Run `npx prisma migrate dev --name init` against an empty PostgreSQL database to create a new baseline.
3. Switch the scripts:
   - `scripts/backup.mjs` and `scripts/reset-password.mjs` only work with SQLite.
   - Use `pg_dump` for backups.
4. Run `npm test` and `npm run test:e2e` against PostgreSQL before relying on it. **This path has not been run in this project's test suite.**
