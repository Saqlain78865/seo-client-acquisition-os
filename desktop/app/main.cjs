// Desktop shell for LeadLift: starts the bundled server on this PC and shows it in a window.
const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
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

let server = null;
let mainWindow = null;
let splash = null;
let quitting = false;

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

async function startServer() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const cfg = loadConfig();
  const log = openLog();
  fs.writeSync(log, `\n[${new Date().toISOString()}] ${APP_NAME} ${app.getVersion()} starting\n`);
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
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
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
    showSplash();
    try {
      createWindow(await startServer());
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
