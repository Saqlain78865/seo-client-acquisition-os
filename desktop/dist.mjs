// Runs electron-builder with the output outside OneDrive (sync locks break the build).
// Passed as one argument, so a user folder with spaces ("C:\Users\NOVA PC") works.
import { spawnSync } from "node:child_process";
import path from "node:path";

const out = path.join(process.env.LOCALAPPDATA ?? path.resolve("dist"), "seo-os-desktop-build");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const cli = path.join(import.meta.dirname, "node_modules", "electron-builder", "cli.js");
const r = spawnSync(process.execPath, [cli, "--win", "nsis", "--publish", "never", `-c.directories.output=${out}`], { stdio: "inherit", env });
process.exit(r.status ?? 1);
