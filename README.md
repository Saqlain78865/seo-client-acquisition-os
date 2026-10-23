# SEO Client Acquisition OS

Audit prospect websites, turn evidence-backed findings into SEO proposals, and manage the
whole client-acquisition pipeline (CRM, follow-ups, outreach) from one dashboard.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Auth, roles, workspaces, design system, dashboard, prospect CRM, follow-ups, deals, CSV export | ✅ Done |
| 2. Audit engine | Safe crawler (SSRF-protected), robots.txt + sitemaps, selective JS rendering, page classification, evidence-based rules, contact extraction, business identification, optional Gemini analysis, background queue with resumable stages | ✅ Done |
| 3. Proposal engine | Evidence-based proposal generator, full editor (sections, findings, roadmap, deliverables, themes; no pricing — fees are agreed at the deal stage), immutable sent versions, duplicate, HTML preview, real PDF export, company settings + logo | ✅ Done |
| 4. Research & CRM | CSV import (Ahrefs / Semrush / Search Console, UTF-8 + UTF-16), keyword ideas, intent, clustering, page mapping, gaps/overlaps, transparent priority, competitor site observation, PageSpeed (lab + real-user data → audit findings), reports page, custom pipeline statuses | ✅ Done |
| 5. Messaging | Integrations page (encrypted credentials, verify-before-save, test, disconnect), Gmail App Password + Gmail drafts (IMAP), Gmail API via Google OAuth, any SMTP, WhatsApp click-to-chat + official Cloud API + signed webhooks, message templates, secure expiring share links + QR codes, consultant WhatsApp QR, idempotent sending, version locking, follow-up reminders, opt-outs | ✅ Done |
| 6. Production readiness | System page (live health checks, failed-job retry/dismiss), structured JSON logs with secret redaction and request ids, CSP + HSTS, team management and password change, workspace export, daily retention clean-up, backup and account-recovery scripts, security review, deployment / troubleshooting / credentials docs | ✅ Done |

## Documentation

| Document | Read it when |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Putting the app online (Windows PC or Linux VPS with HTTPS), updating, backups, monitoring |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Connecting Gmail, PageSpeed, Gemini, WhatsApp — what is needed and where to get it |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Something does not work — errors, lockouts, failed audits, integration errors |
| [docs/SECURITY.md](docs/SECURITY.md) | How data, credentials and outreach are protected, and the known limitations |

## Requirements

- Node.js 22 or newer (tested on 24.20)
- No database server needed for development: SQLite is used through Prisma.

## Setup

```bash
npm install                    # also generates the Prisma client
cp .env.example .env           # then set ENCRYPTION_KEY (command is in the file)
npx prisma migrate dev         # creates dev.db and applies migrations
npm run db:seed                # optional: clearly labelled demo workspace
npm run dev                    # http://localhost:3000
```

On first run, open `/register` to create the **owner account**. Registration closes automatically
after the first user exists (set `ALLOW_REGISTRATION=true` to reopen it).

Demo workspace login (only after `npm run db:seed`): `demo@seo-os.example` / `DemoWorkspace2026`.
All demo prospects use fictional `.example` domains and the header shows a **Demo data** badge.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Unit + integration tests (Vitest, fresh SQLite `test.db`) |
| `npm run test:e2e` | Builds, then runs browser tests (Playwright, fresh `e2e.db`) |
| `npm run db:migrate` | Create/apply a migration after editing `prisma/schema.prisma` |
| `npm run db:seed` | Seed the demo workspace |
| `npm run backup` | Safe copy of the database + PDFs/logos into `./backups/<date>` (works while the app runs) |
| `npm run reset-password -- <email> <password>` | Account recovery from the server (signs the user out everywhere) |

## Project structure

```
prisma/            schema.prisma (full data model for all phases), migrations, seed
src/app/(auth)/    login, first-run registration, server actions
src/app/(app)/     authenticated app: overview, prospects, audits, proposals, … account, system
src/app/api/       route handlers (exports, PDFs, CSV import, OAuth, webhooks, health)
src/app/p/         public share-link pages
src/components/    design system (ui/), app shell, shared components
src/lib/           auth, db, crypto, log, crawler/, audit/, proposals/, research/, messaging/, jobs/, system, team
src/proxy.ts       optimistic auth redirect + request ids (real checks happen server-side)
scripts/           backup, reset-password, manual crawl / PageSpeed checks
docs/              deployment, credentials, troubleshooting, security
tests/             Vitest unit + integration tests
e2e/               Playwright browser tests
```

## How audits work

1. **URL validation**: http(s) only, no credentials, standard ports, and the hostname must resolve to a public IP.
2. **Discovery**: robots.txt (respected for every URL) and XML sitemaps.
3. **Crawl**: same-site pages, one request at a time with a delay, up to the workspace page limit
   (Settings → default 40). Account, cart, search and admin URLs are skipped. Pages whose HTML is
   nearly empty are rendered in an isolated headless Chromium.
4. **Rules** (`src/lib/audit/rules.ts`) turn collected data into findings. Each finding has affected URLs,
   evidence (HTML excerpt, header, status code or measurement) and a severity, and is labelled *Confirmed*, *Potential*
   (needs human judgement) or *Needs data*. Rankings, traffic, index coverage and backlinks are never claimed from a crawl.
5. **Contacts**: public emails, phones, WhatsApp links, addresses and social profiles, each with its source page, are saved
   to the prospect as *unverified*.
6. **AI (optional)**: set `GEMINI_API_KEY` (free key from aistudio.google.com) for a client-friendly summary. The output is
   schema-validated and must reference real findings. Without a key, this stage is marked *skipped*.

Audits run in a database-backed background queue. Every stage is saved, so a retry repeats only
failed stages. To check the crawler against any site from the terminal:
`npx tsx scripts/try-crawl.mts https://example.com 10`.

**OneDrive note:** if `next build` fails with `EPERM` on the `.next` folder, OneDrive is syncing it. Pause
syncing or move the project outside OneDrive (for example `C:\Projects`).

## Security

Summary — details, the Phase 6 review and known limitations are in [docs/SECURITY.md](docs/SECURITY.md):

- bcrypt passwords, login rate limiting, hashed session tokens in httpOnly cookies, owner/admin/member roles checked on the server.
- Every query is scoped to the signed-in workspace.
- Integration credentials are verified before saving and stored AES-256-GCM encrypted; they are never sent to the browser or written to logs.
- SSRF-protected crawler (every IP and redirect checked), strict CSP on proposal HTML, CSP + HSTS app-wide.
- Nothing is sent without a person confirming it; opt-outs and unverified recipients are blocked.

## External credentials

None are required to run the app. See [docs/CREDENTIALS.md](docs/CREDENTIALS.md) for what each one enables,
where to get it (all have a free option) and the current status of this installation.

## Production

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short: one long-running Node server (not serverless),
SQLite on a persistent disk, HTTPS in front, `npm run backup` daily, `/api/health` for uptime monitoring,
and the **System** page for health checks and failed jobs.
