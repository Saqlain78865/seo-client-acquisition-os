// Desktop shell for LeadLift: starts the bundled server on this PC and shows it in a window.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_NAME = "LeadLift";
const PREFERRED_PORT = 47831;

// Packaged: resources next to the app. Development (`npm start` in desktop/): the prepared build folder.
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "build");
const SERVER_DIR = path.join(RES, "server");
const NODE_EXE = path.join(RES, "node", "node.exe");
const MIGRATIONS_DIR = path.join(RES, "migrations");

// Data stays in the folder used before the LeadLift rename, so updating keeps everything.
// SEO_OS_DATA_DIR points the app at another data folder (used for testing a build without touching real data).
app.setPath("userData", process.env.SEO_OS_DATA_DIR ? path.resolve(process.env.SEO_OS_DATA_DIR) : path.join(app.getPath("appData"), "SEO Acquisition OS"));
const DATA_DIR = app.getPath("userData");
const DB_PATH = path.join(DATA_DIR, "data.db");
const STORAGE_DIR = path.join(DATA_DIR, "storage");
const LOG_DIR = path.join(DATA_DIR, "logs");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
// Windows' own tar (10 1803 and later) writes and reads .zip files.
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

let server = null;
let mainWindow = null;
let splash = null;
let quitting = false;
let appUrl = null;
let logFd = null;
let updater = null;

const logLine = (msg) => {
  try {
    if (logFd != null) fs.writeSync(logFd, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // Logging must never break the app.
  }
};
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");

/** Settings kept between runs. The encryption key protects saved integration credentials and must never change. */
function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // First run.
  }
  if (!cfg.encryptionKey) {
    cfg.encryptionKey = crypto.randomBytes(32).toString("base64");
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }
  return cfg;
}

function freePort(preferred) {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(null));
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(port)));
    });
  return tryPort(preferred).then(
    (p) =>
      p ??
      new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => {
          const { port } = s.address();
          s.close(() => resolve(port));
        });
      }),
  );
}

function openLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, "server.log");
  // Start a fresh log when the old one gets large.
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, path.join(LOG_DIR, "server.old.log"));
  } catch {
    // No log yet.
  }
  return fs.openSync(file, "a");
}

/** Applies any new database changes before the server starts (same records as `prisma migrate deploy`). */
function migrate(log) {
  const r = spawnSync(NODE_EXE, [path.join(SERVER_DIR, "desktop-migrate.cjs"), DB_PATH, MIGRATIONS_DIR], { cwd: SERVER_DIR, encoding: "utf8", windowsHide: true });
  fs.writeSync(log, `[${new Date().toISOString()}] migrate: ${r.stdout ?? ""}${r.stderr ?? ""}\n`);
  if (r.status !== 0) throw new Error(`The database could not be updated.\n\n${(r.stderr || r.error?.message || "").slice(0, 600)}`);
}

function waitForHealth(url, child, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let exited = false;
    child.once("exit", (code) => {
      exited = true;
      reject(new Error(`The app's server stopped while starting (code ${code}).`));
    });
    const poll = () => {
      if (exited) return;
      if (Date.now() - started > timeoutMs) return reject(new Error("The app's server did not start in time."));
      http
        .get(`${url}/api/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else setTimeout(poll, 500);
        })
        .on("error", () => setTimeout(poll, 500));
    };
    poll();
  });
}

/**
 * After an update, the database is copied before the new version changes it, so an update can
 * always be undone. The last five copies are kept in the data folder's "backups".
 */
function backupBeforeUpgrade(cfg) {
  const version = app.getVersion();
  if (cfg.lastVersion && cfg.lastVersion !== version && fs.existsSync(DB_PATH)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const base = path.join(BACKUP_DIR, `data-before-${version}-${stamp()}.db`);
    fs.copyFileSync(DB_PATH, base);
    for (const ext of ["-wal", "-shm"]) if (fs.existsSync(DB_PATH + ext)) fs.copyFileSync(DB_PATH + ext, base + ext);
    logLine(`upgrade ${cfg.lastVersion} → ${version}: database copied to ${base}`);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^data-before-.*\.db$/.test(f)).sort().reverse().slice(5);
    for (const f of old) for (const ext of ["", "-wal", "-shm"]) fs.rmSync(path.join(BACKUP_DIR, f + ext), { force: true });
  }
  if (cfg.lastVersion !== version) {
    cfg.lastVersion = version;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }
}

function run(cmd, args, what) {
  const r = spawnSync(cmd, args, { cwd: SERVER_DIR, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.error?.message || `exit ${r.status}`).slice(0, 400)}`);
}

/** One .zip with everything: the database (consistent copy), saved files (PDFs, screenshots) and the settings key. */
function backupTo(file) {
  const stage = fs.mkdtempSync(path.join(app.getPath("temp"), "leadlift-backup-"));
  try {
    run(NODE_EXE, [path.join(SERVER_DIR, "desktop-backup.cjs"), DB_PATH, path.join(stage, "data.db")], "Copying the database");
    fs.copyFileSync(CONFIG_PATH, path.join(stage, "config.json"));
    fs.writeFileSync(path.join(stage, "leadlift-backup.json"), JSON.stringify({ app: APP_NAME, version: app.getVersion(), createdAt: new Date().toISOString() }, null, 2));
    fs.rmSync(file, { force: true });
    const args = ["-a", "-cf", file, "-C", stage, "data.db", "config.json", "leadlift-backup.json"];
    if (fs.existsSync(STORAGE_DIR)) args.push("-C", DATA_DIR, "storage");
    run(TAR, args, "Creating the backup file");
    logLine(`backup saved to ${file}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

async function backupInteractive() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save a backup of LeadLift",
    defaultPath: path.join(app.getPath("documents"), `LeadLift-backup-${stamp()}.zip`),
    filters: [{ name: "LeadLift backup", extensions: ["zip"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    backupTo(filePath);
    shell.showItemInFolder(filePath);
    return { ok: true, file: filePath };
  } catch (e) {
    dialog.showErrorBox(APP_NAME, e.message);
    return { ok: false, error: e.message };
  }
}

/** Replaces all data with a backup. The current data is backed up first, then the app restarts. */
async function restoreInteractive() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: "Restore LeadLift from a backup", properties: ["openFile"], filters: [{ name: "LeadLift backup", extensions: ["zip"] }] });
  if (canceled || !filePaths[0]) return { ok: false, canceled: true };
  const stage = fs.mkdtempSync(path.join(app.getPath("temp"), "leadlift-restore-"));
  try {
    run(TAR, ["-xf", filePaths[0], "-C", stage], "Opening the backup");
    if (!fs.existsSync(path.join(stage, "data.db")) || !fs.existsSync(path.join(stage, "config.json"))) throw new Error("This file is not a LeadLift backup.");
    const meta = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(stage, "leadlift-backup.json"), "utf8"));
      } catch {
        return {};
      }
    })();
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Restore and restart", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: APP_NAME,
      message: "Replace all current data with this backup?",
      detail: `Backup from ${meta.createdAt ? new Date(meta.createdAt).toLocaleString() : "an unknown date"}${meta.version ? ` (LeadLift ${meta.version})` : ""}.\n\nYour current data is saved first to:\n${BACKUP_DIR}`,
    });
    if (response !== 0) return { ok: false, canceled: true };
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    backupTo(path.join(BACKUP_DIR, `before-restore-${stamp()}.zip`));

    quitting = true;
    if (server) {
      const s = server;
      await new Promise((resolve) => {
        s.once("exit", resolve);
        s.kill();
        setTimeout(resolve, 8000);
      });
    }
    for (const ext of ["", "-wal", "-shm", "-journal"]) fs.rmSync(DB_PATH + ext, { force: true });
    fs.copyFileSync(path.join(stage, "data.db"), DB_PATH);
    fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
    if (fs.existsSync(path.join(stage, "storage"))) fs.cpSync(path.join(stage, "storage"), STORAGE_DIR, { recursive: true });
    // Saved credentials were encrypted with the backup's key, so that key comes back with the data.
    const current = loadConfig();
    const restored = JSON.parse(fs.readFileSync(path.join(stage, "config.json"), "utf8"));
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...restored, lastVersion: app.getVersion() }, null, 2));
    logLine(`restored from ${filePaths[0]}`);
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    dialog.showErrorBox(APP_NAME, `${e.message}\n\nThe backup of your data from just before is in:\n${BACKUP_DIR}`);
    // The server was already stopped: start the app again on whatever data is in place.
    if (quitting) {
      app.relaunch();
      app.exit(1);
    }
    return { ok: false, error: e.message };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * Updates come from the GitHub releases of the project. A new version downloads in the background
 * and installs when the user agrees (or the next time the app closes). Data is never touched by an
 * update, and the database is copied before the new version first opens it.
 */
function setupUpdates() {
  if (!app.isPackaged) return null;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    logLine(`updates unavailable: ${e.message}`);
    return null;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => logLine(`update: ${m}`), warn: (m) => logLine(`update: ${m}`), error: (m) => logLine(`update error: ${m}`), debug: () => {} };
  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: APP_NAME,
      message: `LeadLift ${info.version} is ready to install`,
      detail: "Your prospects, proposals and settings stay as they are, and a copy of the database is saved first. Choose Later to install when you close the app.",
    });
    if (response === 0) {
      quitting = true;
      server?.kill();
      autoUpdater.quitAndInstall();
    }
  });
  const check = () => autoUpdater.checkForUpdates().catch((e) => logLine(`update check failed: ${e.message}`));
  setTimeout(check, 20_000);
  setInterval(check, 6 * 3600_000).unref?.();
  return autoUpdater;
}

async function checkForUpdatesNow() {
  if (!updater) return { status: "unavailable", current: app.getVersion() };
  try {
    const r = await updater.checkForUpdates();
    const available = !!r?.isUpdateAvailable;
    return { status: available ? "downloading" : "latest", current: app.getVersion(), latest: r?.updateInfo?.version ?? null };
  } catch (e) {
    return { status: "error", current: app.getVersion(), error: String(e.message || e).slice(0, 200) };
  }
}

function setupIpc() {
  // Only pages of this app (never a website) may call the desktop features.
  const fromApp = (e) => {
    try {
      return !!appUrl && new URL(e.senderFrame.url).origin === appUrl;
    } catch {
      return false;
    }
  };
  const guard = (fn) => (e) => (fromApp(e) ? fn() : { ok: false, error: "Not allowed." });
  ipcMain.handle("desktop:version", guard(() => ({ version: app.getVersion(), dataDir: DATA_DIR, updates: !!updater })));
  ipcMain.handle("desktop:backup", guard(backupInteractive));
  ipcMain.handle("desktop:restore", guard(restoreInteractive));
  ipcMain.handle("desktop:check-updates", guard(checkForUpdatesNow));
}

async function startServer() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const cfg = loadConfig();
  const log = openLog();
  logFd = log;
  fs.writeSync(log, `\n[${new Date().toISOString()}] ${APP_NAME} ${app.getVersion()} starting\n`);
  backupBeforeUpgrade(cfg);
  migrate(log);
  const port = await freePort(PREFERRED_PORT);
  const url = `http://127.0.0.1:${port}`;
  server = spawn(NODE_EXE, [path.join(SERVER_DIR, "desktop-server.cjs")], {
    cwd: SERVER_DIR,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      // Optional API keys can be added under "env" in config.json; most are also set on the Integrations page.
      ...(cfg.env ?? {}),
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      APP_URL: url,
      DATABASE_URL: `file:${DB_PATH.replace(/\\/g, "/")}`,
      STORAGE_DIR,
      ENCRYPTION_KEY: cfg.encryptionKey,
      // Audits, screenshots and PDFs use Microsoft Edge, which every Windows 10/11 PC has.
      BROWSER_CHANNEL: cfg.browserChannel ?? "msedge",
      NEXT_TELEMETRY_DISABLED: "1",
      SEO_OS_DESKTOP: "1",
      SEO_OS_PARENT_PID: String(process.pid),
    },
  });
  server.once("exit", (code) => {
    server = null;
    if (!quitting && mainWindow) {
      dialog.showErrorBox(APP_NAME, `The app's server stopped unexpectedly (code ${code}).\n\nDetails are in:\n${path.join(LOG_DIR, "server.log")}`);
      app.quit();
    }
  });
  await waitForHealth(url, server);
  appUrl = url;
  return url;
}

function showSplash() {
  splash = new BrowserWindow({ width: 420, height: 300, frame: false, resizable: false, show: true, backgroundColor: "#0b1130", alwaysOnTop: true, skipTaskbar: false, title: APP_NAME, icon: path.join(__dirname, "icon.png") });
  splash.loadFile(path.join(__dirname, "splash.html"));
}

function buildMenu() {
  const openPath = (p) => () => shell.openPath(p);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          { label: "Back up data…", click: () => backupInteractive() },
          { label: "Restore from backup…", click: () => restoreInteractive() },
          { type: "separator" },
          { label: "Open data folder", click: openPath(DATA_DIR) },
          { label: "Open server log", click: openPath(path.join(LOG_DIR, "server.log")) },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [{ role: "reload" }, { type: "separator" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" }],
      },
      {
        label: "Help",
        submenu: [
          {
            label: "Check for updates",
            click: async () => {
              const r = await checkForUpdatesNow();
              const message =
                r.status === "downloading" ? `LeadLift ${r.latest} is downloading — you'll be asked to restart when it's ready.` : r.status === "latest" ? `You have the latest version (${r.current}).` : r.status === "unavailable" ? "Updates work in the installed app." : `Could not check for updates: ${r.error}`;
              dialog.showMessageBox(mainWindow, { type: "info", title: APP_NAME, message });
            },
          },
          {
            label: `About ${APP_NAME}`,
            click: () => dialog.showMessageBox(mainWindow, { type: "info", title: APP_NAME, message: `${APP_NAME} ${app.getVersion()}`, detail: `Your data is stored on this PC in:\n${DATA_DIR}` }),
          },
        ],
      },
    ]),
  );
}

/** Downloads (proposal PDFs) go straight to the Downloads folder, which then opens with the file selected —
 * ready to drag into a WhatsApp chat or an email. */
function saveDownloads() {
  session.defaultSession.on("will-download", (_e, item) => {
    const dir = app.getPath("downloads");
    const parsed = path.parse(item.getFilename());
    let target = path.join(dir, parsed.base);
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
    item.setSavePath(target);
    item.once("done", (_ev, state) => {
      if (state === "completed") shell.showItemInFolder(target);
    });
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: "#f4f6fb",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, preload: path.join(__dirname, "preload.cjs") },
  });
  const inside = (target) => {
    try {
      return new URL(target).origin === url;
    } catch {
      return false;
    }
  };
  // Pages of the app open in the app; everything else (client websites, wa.me, mailto) in the user's apps.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (inside(target)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(__dirname, "icon.png") } };
    shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, target) => {
    if (!inside(target)) {
      e.preventDefault();
      shell.openExternal(target);
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
    splash?.destroy();
    splash = null;
  });
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    saveDownloads();
    setupIpc();
    showSplash();
    try {
      createWindow(await startServer());
      updater = setupUpdates();
    } catch (e) {
      splash?.destroy();
      dialog.showErrorBox(APP_NAME, `${e.message}\n\nDetails are in:\n${path.join(LOG_DIR, "server.log")}`);
      quitting = true;
      server?.kill();
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    server?.kill();
  });
}
