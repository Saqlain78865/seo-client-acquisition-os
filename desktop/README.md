# Desktop app (Windows)

The same system as the browser version, packaged as a Windows app. It runs completely on the PC:
no online server is needed.

## How it works

- **Electron window.** It shows the app and opens client websites, `wa.me` and `mailto:` links in your normal apps.
- **Built-in server.** The Next.js server runs on `127.0.0.1` with its own bundled Node runtime (`resources/node/node.exe`).
- **Data stays on this PC**, in `%APPDATA%\SEO Acquisition OS`:
  - `data.db` holds prospects, audits, proposals and settings.
  - `storage/` holds PDFs, logos and screenshots.
  - `config.json` holds the encryption key for saved connections, plus optional `env` API keys.
  - `logs/server.log` is the server log.
- **Database updates apply on start.** New versions apply database changes automatically with `desktop-migrate.cjs`, recorded the same way as `prisma migrate deploy`.
- **Audits, screenshots and PDFs use Microsoft Edge**, which is installed on every Windows 10/11 PC. Playwright's own Chromium is used if Edge is missing.
- **Uninstalling keeps your data.** The data folder stays.

## Build the installer

Run this from the project root, after `npm install` there:

```powershell
cd desktop
npm install
node node_modules/electron/install.js   # downloads Electron if npm skipped install scripts
npm run dist                            # → %LOCALAPPDATA%\seo-os-desktop-build\SEO-Acquisition-OS-Setup-<version>.exe
```

The installer is built outside the project folder on purpose: OneDrive locks files while it syncs, which breaks electron-builder. `after-pack.cjs` adds the server's `node_modules`, which electron-builder always leaves out of extra resources.

`npm start` (in `desktop/`, after `node build.mjs`) runs the app without installing it. In a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` first, otherwise Electron starts as plain Node.

## Bring over the data of the browser version

Close the desktop app, then from the project root run:

```powershell
node desktop/import-dev-data.mjs
```

This copies `dev.db`, `storage/` and the keys from `.env` into the app's data folder. It refuses to overwrite existing desktop data.

## Limits of a PC-only app

- **Share links (`/p/...`) are local.** They point at this PC, so clients cannot open them from the internet. Their reading analytics and online "Accept" therefore need the app to be reachable online, for example through a tunnel or a server. Email the PDF instead.
- **Google sign-in for Gmail needs an extra redirect URI.** Register `http://127.0.0.1:47831/api/integrations/google/callback`. Gmail with an App Password works without it.
