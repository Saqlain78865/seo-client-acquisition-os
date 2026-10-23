// Starts the Next.js server for the desktop app and stops it if the app window process goes away
// (for example after a crash), so no server is left running in the background.
const parent = Number(process.env.SEO_OS_PARENT_PID);
if (parent) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref();
}
require("./server.js");
