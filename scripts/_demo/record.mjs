// Records the LeadLift product tour from the running app (demo data) as 1920×1080 frames, then
// encodes an H.264 MP4. Usage: node scripts/_demo/record.mjs <baseUrl> <outDir> <ffmpeg.exe>
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [base, outDir, ffmpeg] = process.argv.slice(2);
const framesDir = path.join(outDir, "frames");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
const page = await context.newPage();

// Caption bar and a visible cursor, drawn on every page of the tour.
await context.addInitScript(() => {
  const ready = () => {
    if (document.getElementById("__cap")) return;
    const st = document.createElement("style");
    st.textContent = `#__cap{position:fixed;left:50%;bottom:34px;transform:translate(-50%,16px);opacity:0;z-index:2147483647;pointer-events:none;transition:opacity .45s,transform .45s;
      background:rgba(11,17,48,.92);color:#fff;border-radius:16px;padding:14px 26px;font:600 20px/1.35 "Segoe UI",Arial,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35);max-width:78vw;text-align:center;border:1px solid rgba(165,180,252,.35)}
      #__cap small{display:block;font-weight:400;font-size:15px;opacity:.75;margin-top:3px}#__cap.on{opacity:1;transform:translate(-50%,0)}
      #__cur{position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-3px 0 0 -3px;transition:transform .12s}
      #__cur.down{transform:scale(.8)}#__ring{position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;margin:-22px;border-radius:50%;border:3px solid #818cf8;opacity:0}
      #__ring.go{animation:__r .5s ease-out}@keyframes __r{from{opacity:.9;transform:scale(.4)}to{opacity:0;transform:scale(1.4)}}`;
    document.head.appendChild(st);
    const cap = Object.assign(document.createElement("div"), { id: "__cap" });
    const cur = Object.assign(document.createElement("div"), { id: "__cur" });
    cur.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const ring = Object.assign(document.createElement("div"), { id: "__ring" });
    document.body.append(cap, ring, cur);
    const last = JSON.parse(sessionStorage.getItem("__pos") || "[800,450]");
    cur.style.left = `${last[0]}px`;
    cur.style.top = `${last[1]}px`;
    addEventListener("mousemove", (e) => {
      cur.style.left = `${e.clientX}px`;
      cur.style.top = `${e.clientY}px`;
      sessionStorage.setItem("__pos", JSON.stringify([e.clientX, e.clientY]));
    }, true);
    addEventListener("mousedown", (e) => {
      cur.classList.add("down");
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      ring.classList.remove("go");
      void ring.offsetWidth;
      ring.classList.add("go");
    }, true);
    addEventListener("mouseup", () => cur.classList.remove("down"), true);
    const saved = sessionStorage.getItem("__capText");
    if (saved) {
      cap.innerHTML = saved;
      cap.classList.add("on");
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  window.__setCap = (html) => {
    const cap = document.getElementById("__cap");
    if (!cap) return;
    sessionStorage.setItem("__capText", html || "");
    if (!html) return cap.classList.remove("on");
    cap.classList.remove("on");
    setTimeout(() => {
      cap.innerHTML = html;
      cap.classList.add("on");
    }, 250);
  };
});

// Screencast: every frame Chromium paints, with its timestamp.
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = path.join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

const wait = (ms) => page.waitForTimeout(ms);
const cap = async (title, sub) => {
  await page.evaluate(([t, s]) => window.__setCap?.(t ? `${t}${s ? `<small>${s}</small>` : ""}` : ""), [title, sub ?? ""]);
};
let mouse = [800, 450];
const moveTo = async (x, y, steps = 25) => {
  await page.mouse.move(x, y, { steps });
  mouse = [x, y];
};
const click = async (locator) => {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (!b) throw new Error("not visible");
  await moveTo(b.x + b.width / 2, b.y + b.height / 2);
  await wait(250);
  await page.mouse.down();
  await page.mouse.up();
};
const nav = async (label) => {
  await click(page.locator("aside").getByRole("link", { name: label, exact: true }));
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(700);
};
// Smooth scroll of the page to a position (or by an amount), over a duration.
const scroll = async (to, ms = 1600) => {
  await page.evaluate(
    ([to, ms]) =>
      new Promise((done) => {
        const from = scrollY;
        const target = typeof to === "number" ? to : document.body.scrollHeight - innerHeight;
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          scrollTo(0, from + (target - from) * e);
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      }),
    [to, ms],
  );
};
// The proposal preview is a sandboxed frame: scroll it with the mouse wheel, like a person would.
const wheelPreview = async (px, ms) => {
  const b = await page.locator('iframe[title="Proposal preview"]').boundingBox();
  if (!b) return;
  await moveTo(b.x + b.width * 0.6, b.y + Math.min(b.height / 2, 300));
  const steps = Math.round(ms / 40);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await page.waitForTimeout(40);
  }
};
const scrollToEl = async (locator, offset = 90, ms = 1400) => {
  const y = await locator.first().evaluate((el, off) => el.getBoundingClientRect().top + scrollY - off, offset);
  await scroll(Math.max(0, y), ms);
};

const card = (title, sub, kicker) => `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;font-family:'Segoe UI',Arial,sans-serif;color:#fff;
background:radial-gradient(900px 500px at 85% -10%,rgba(139,92,246,.55),transparent 60%),radial-gradient(800px 500px at 0% 110%,rgba(6,182,212,.35),transparent 60%),linear-gradient(160deg,#070b22,#1e1b4b 70%,#2e1065)">
<div style="text-align:center;animation:in 1s cubic-bezier(.16,1,.3,1) both"><div style="display:inline-flex;align-items:center;gap:18px">
<svg width="84" height="84" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#a)"/><path d="M20 16v30h22" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 30l11-11m0 0h-9m9 0v9" stroke="#67e8f9" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
<span style="font-size:64px;font-weight:800;letter-spacing:-1px">Lead<span style="background:linear-gradient(90deg,#a5b4fc,#67e8f9);-webkit-background-clip:text;color:transparent">Lift</span></span></div>
${kicker ? `<p style="margin:26px 0 0;font-size:16px;letter-spacing:.32em;text-transform:uppercase;color:#a5b4fc">${kicker}</p>` : ""}
<h1 style="margin:14px 0 0;font-size:40px;font-weight:700">${title}</h1><p style="margin:12px 0 0;font-size:22px;opacity:.75">${sub}</p></div>
<style>@keyframes in{from{opacity:0;transform:translateY(24px);filter:blur(8px)}to{opacity:1;transform:none;filter:none}}</style></body></html>`;

await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

// ── 1. Title ──
await page.setContent(card("Audit · Propose · Win", "From a website address to a signed client — a 2-minute tour", "Product tour"));
await wait(4200);

// ── 2. Sign in ──
await page.goto(`${base}/login`);
await cap("Sign in to your agency workspace", "Everything runs on your own PC — your data stays with you");
await click(page.getByLabel("Email"));
await page.keyboard.type("demo@leadlift.app", { delay: 45 });
await click(page.getByLabel("Password"));
await page.keyboard.type("LeadLiftDemo2026!", { delay: 35 });
await click(page.getByRole("button", { name: "Sign in" }));
await page.waitForURL(`${base}/`);
await page.waitForLoadState("networkidle").catch(() => {});

// ── 3. Overview ──
await cap("Overview — your day at a glance", "Paste a website here and the audit + proposal are prepared for you");
await wait(4200);
await cap("Who to contact today", "Replies, clients reading your proposal right now, and follow-ups that are due");
await scrollToEl(page.getByText("Who to contact today"), 90);
await wait(3000);
await cap("Live numbers from your workspace", "Prospects, audits, proposals sent, deals won");
await scroll(900, 1800);
await wait(1800);
await scroll(0, 1200);

// ── 4. New audit ──
await nav("New Website Audit");
await cap("New Website Audit", "Paste any page — or a Google Maps link — and the whole website is checked");
await wait(1500);
await click(page.getByLabel("Website URL"));
await page.keyboard.type("desertskyballoons.ae", { delay: 70 });
await wait(2600);
await scrollToEl(page.getByLabel("Client / business name"), 260, 1200);
await wait(1800);

// ── 5. Audit report ──
await nav("Audit Reports");
await cap("Audit Reports", "Every audit with its status — open one to see the evidence");
await wait(1800);
await click(page.getByRole("link", { name: /desertskyballoons/ }));
await page.waitForLoadState("networkidle").catch(() => {});
await cap("Every issue with proof", "What we found, on which page, why it matters and how to fix it");
await wait(1800);
await scroll(1200, 3000);
await wait(1600);

// ── 6. Proposals ──
await nav("SEO Proposals");
await cap("SEO Proposals", "See what is still a draft, what went out — by Gmail or WhatsApp — and what was opened");
await wait(3200);
await click(page.getByRole("link", { name: /Bright Smile/ }));
await page.waitForLoadState("networkidle").catch(() => {});
await cap("A designed proposal, ready as PDF", "Built from the audit: findings, screenshots, Google profile, plan and next steps");
await wait(1500);
await wheelPreview(5200, 6000);
await wait(800);
await cap("Know how the client read it", "Time spent on each section — the best moment to call");
await scrollToEl(page.getByText("How the client read it"), 100, 1400);
await wait(3000);
await scroll(0, 1000);
await click(page.getByRole("link", { name: "Send", exact: true }));
await page.waitForLoadState("networkidle").catch(() => {});
await cap("Send by Gmail with the PDF attached", "Or WhatsApp in one click — follow-ups are scheduled for you");
await wait(3000);

// ── 7. WhatsApp status ──
await nav("SEO Proposals");
await click(page.getByRole("link", { name: /Karachi City Movers/ }));
await page.waitForLoadState("networkidle").catch(() => {});
await cap("Sent on WhatsApp? Mark it — and when they've seen it", "LeadLift schedules the follow-up and prepares the message");
await wait(4200);

// ── 8. Reputation ──
await nav("Reputation");
await cap("Reputation — bad Google reviews into a proposal", "Add a business by its Google Maps link, or name and website");
await wait(3000);
await click(page.getByRole("link", { name: /Desert Sky Balloon Rides/ }));
await page.waitForLoadState("networkidle").catch(() => {});
await cap("AI checks every bad review against Google's policies", "Which can be reported for removal — and which need a professional reply");
await scrollToEl(page.getByText("Reputation — bad reviews"), 90, 1800);
await wait(4200);
await nav("SEO Proposals");
await click(page.getByRole("link", { name: /Reputation rescue plan/ }));
await page.waitForLoadState("networkidle").catch(() => {});
await cap("A reputation proposal the client wants to accept", "Their bad reviews, your screenshots and an honest plan");
await wait(1200);
// The preview frame runs no scripts: jump to the section by its anchor, then scroll with the wheel.
await page.locator('iframe[title="Proposal preview"]').evaluate((f) => (f.src = f.src.split("#")[0] + "#reputation"));
await wait(900);
await wheelPreview(1400, 3600);
await wait(2400);

// ── 9. Bulk, prospects, follow-ups, auto-send, deals, client work ──
await nav("Bulk Audit");
await cap("Bulk Audit", "Paste a list of websites — audited three at a time and ranked by opportunity");
await wait(3800);
await nav("Prospects");
await cap("Prospects — your whole pipeline", "Every lead with its status, value and next follow-up");
await wait(3600);
await nav("Auto-send");
await cap("Auto-send", "Approve a list once — up to 20 proposals a day go out from your Gmail");
await wait(2800);
await nav("Client Work");
await cap("Client Work", "Monthly tasks for won clients, a printable report — and a monthly re-audit");
await wait(3200);
await nav("Integrations");
await cap("Integrations", "Connect your Gmail and free Google / Gemini keys — no paid tools needed");
await wait(3000);
await cap("");

// ── 10. End ──
await page.setContent(card("Win more SEO clients", "Audit any website · Send a proposal that sells · Follow up on time", "LeadLift"));
await wait(4500);

await cdp.send("Page.stopScreencast");
await browser.close();

// ── Encode: each frame shown until the next one arrived ──
const list = [];
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? Math.max(1 / 60, frames[i + 1].t - frames[i].t) : 1;
  list.push(`file '${frames[i].file.replace(/\\/g, "/")}'`, `duration ${d.toFixed(4)}`);
}
list.push(`file '${frames.at(-1).file.replace(/\\/g, "/")}'`);
const listFile = path.join(outDir, "frames.txt");
fs.writeFileSync(listFile, list.join("\n"));
const out = path.join(outDir, "LeadLift-Product-Tour.mp4");
execFileSync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "setpts=PTS/1.12,fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", out], { stdio: "inherit" });
console.log("frames", frames.length, "→", out);
