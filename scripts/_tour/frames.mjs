// Saves frames of a tour MP4 at given seconds (for checking the look).
// Usage: node scripts/_tour/frames.mjs <mp4> <outPrefix> <t1> <t2> …
import fs from "node:fs";
import { chromium } from "playwright";

const [file, prefix, ...times] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.route("https://v.local/**", (r) =>
  r.request().url().endsWith("/v.mp4") ? r.fulfill({ contentType: "video/mp4", body: fs.readFileSync(file) }) : r.fulfill({ contentType: "text/html", body: "<body style='margin:0;background:#000'><video id=v muted style='width:1920px;height:1080px'></video></body>" }),
);
await p.goto("https://v.local/");
// A blob URL can be seeked anywhere (the routed response has no byte ranges).
const duration = await p.evaluate(async () => {
  const v = document.getElementById("v");
  v.src = URL.createObjectURL(await (await fetch("/v.mp4")).blob());
  await new Promise((r) => (v.readyState >= 1 ? r() : v.addEventListener("loadedmetadata", () => r(), { once: true })));
  return v.duration;
});
for (const t of times) {
  await p.evaluate(
    (s) =>
      new Promise((r) => {
        const v = document.getElementById("v");
        v.addEventListener("seeked", () => r(), { once: true });
        v.currentTime = s;
      }),
    Number(t),
  );
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${prefix}-${t}.jpg`, type: "jpeg", quality: 80 });
}
console.log(duration);
await b.close();
