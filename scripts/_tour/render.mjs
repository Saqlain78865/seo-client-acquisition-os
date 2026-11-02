// Renders the product tour MP4 from capture.mjs output: narration with the Windows voice, a soft
// music bed that ducks under the voice, subtitles, and the motion graphics in renderer.js.
// Usage: node scripts/_tour/render.mjs <outDir> <output.mp4> [female|male]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const [outDir, outFile, voiceArg = "female"] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
const RATE = 48000;

// ── Scenes ──
const real = manifest.chapters.filter((c, i) => i > 0 && !c.outro);
const scenes = [];
manifest.chapters.forEach((c, i) => {
  const number = i === 0 || c.outro ? 0 : i;
  const chapter = { number, title: c.title, subtitle: c.subtitle, steps: c.steps.length, of: real.length };
  scenes.push({ kind: i === 0 ? "intro" : c.outro ? "outro" : "card", chapter, narration: c.narration });
  for (const s of c.steps) scenes.push({ kind: "step", chapter, narration: s.narration, image: s.image, focus: s.focus, callout: s.callout, click: s.click, zoom: s.zoom });
});

// A short preview (TOUR_LIMIT=n scenes) for checking the look.
if (Number(process.env.TOUR_LIMIT)) scenes.splice(Number(process.env.TOUR_LIMIT));

// ── Voice (Windows text-to-speech, offline) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tour-voice-"));
const lines = scenes.map((s, i) => ({ text: s.narration, file: path.join(tmp, `${i}.wav`) }));
fs.writeFileSync(path.join(tmp, "lines.json"), JSON.stringify(lines), "utf8");
fs.writeFileSync(
  path.join(tmp, "speak.ps1"),
  `param([string]$Json, [string]$Voice)
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 -Path $Json | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice($Voice) } catch { }
$s.Rate = 0
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($i in $items) { $s.SetOutputToWaveFile($i.file, $fmt); $s.Speak([string]$i.text) }
$s.SetOutputToNull(); $s.Dispose()
`,
  "utf8",
);
console.log(`speaking ${lines.length} lines…`);
const voiceName = voiceArg === "male" ? "Microsoft David Desktop" : "Microsoft Zira Desktop";
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(tmp, "speak.ps1"), "-Json", path.join(tmp, "lines.json"), "-Voice", voiceName], { stdio: "inherit", windowsHide: true });
const wav = (file) => {
  const b = fs.readFileSync(file);
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "data") return new Int16Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + (size & ~1)));
    at += 8 + size + (size & 1);
  }
  return new Int16Array(0);
};
const speech = lines.map((l) => wav(l.file));
fs.rmSync(tmp, { recursive: true, force: true });

// ── Timing: every scene lasts as long as its narration, with room to breathe ──
const LEAD = { intro: 1.6, card: 0.8, step: 0.55, outro: 1.2 };
const MIN = { intro: 6, card: 3.4, step: 4.8, outro: 7.5 };
const TAIL = { intro: 1.0, card: 0.7, step: 0.95, outro: 2.2 };
scenes.forEach((s, i) => {
  const secs = speech[i].length / RATE;
  s.lead = LEAD[s.kind];
  s.speech = secs;
  s.dur = Math.max(MIN[s.kind], s.lead + secs + TAIL[s.kind]);
  // Subtitles: sentence chunks, timed by their length within the narration.
  const chunks = [];
  for (const sentence of s.narration.match(/[^.!?]+[.!?]*/g) ?? [s.narration]) {
    const t = sentence.trim();
    if (!t) continue;
    if (t.length <= 95) chunks.push(t);
    else {
      const parts = t.split(/(?<=,)\s+|\s+—\s+/);
      let cur = "";
      for (const p of parts) {
        if ((cur + " " + p).trim().length > 95 && cur) {
          chunks.push(cur.trim());
          cur = p;
        } else cur = `${cur} ${p}`;
      }
      if (cur.trim()) chunks.push(cur.trim());
    }
  }
  const chars = chunks.reduce((a, c) => a + c.length, 0) || 1;
  let at = s.lead;
  s.subs = chunks.map((c) => {
    const d = (c.length / chars) * secs;
    const k = { text: c, from: at, to: at + d + (c === chunks.at(-1) ? 0.5 : 0) };
    at += d;
    return k;
  });
});
const total = scenes.reduce((a, s) => a + s.dur, 0);
console.log(`${scenes.length} scenes, ${(total / 60).toFixed(1)} minutes`);

// ── Audio: voice + a soft pad that ducks under it ──
const n = Math.ceil(total * RATE) + RATE;
const voice = new Float32Array(n);
let t0 = 0;
scenes.forEach((s, i) => {
  const off = Math.round((t0 + s.lead) * RATE);
  const pcm = speech[i];
  for (let j = 0; j < pcm.length && off + j < n; j++) voice[off + j] = pcm[j] / 32768;
  s.start = t0;
  t0 += s.dur;
});
// Voice envelope (for ducking).
const env = new Float32Array(n);
let e = 0;
for (let i = 0; i < n; i++) {
  const v = Math.abs(voice[i]);
  e = v > e ? e + (v - e) * 0.01 : e * 0.99995;
  env[i] = e;
}
const chords = [
  [261.63, 329.63, 392.0, 493.88],
  [220.0, 261.63, 329.63, 392.0],
  [174.61, 220.0, 261.63, 329.63],
  [196.0, 246.94, 293.66, 329.63],
];
const BAR = 4;
const out = new Int16Array(n);
for (let i = 0; i < n; i++) {
  const t = i / RATE;
  const bar = Math.floor(t / BAR);
  const inBar = t - bar * BAR;
  const chord = chords[bar % chords.length];
  const att = Math.min(inBar / 1.2, 1) * Math.min((BAR - inBar) / 0.8 + 0.25, 1);
  let m = 0;
  for (let k = 0; k < chord.length; k++) {
    const f = chord[k];
    m += Math.sin(2 * Math.PI * f * t + k) * 0.6 + Math.sin(2 * Math.PI * f * 2.001 * t) * 0.12;
  }
  m += Math.sin(2 * Math.PI * (chord[0] / 2) * t) * 0.7;
  m *= att / chord.length;
  // Slow shimmer, fade in and out, ducking under the voice.
  const shimmer = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.11 * t);
  const fade = Math.min(t / 2.5, 1) * Math.min((total - t) / 3.5, 1);
  const duck = 1 - Math.min(env[i] * 9, 0.72);
  const music = m * 0.11 * shimmer * Math.max(fade, 0) * duck;
  const v = voice[i] * 0.98 + music;
  out[i] = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
}

// ── Render in a headless browser ──
const browser = await chromium.launch({ args: ["--js-flags=--max-old-space-size=4096"] });
const page = await browser.newPage();
const pcmBuf = Buffer.from(out.buffer);
await page.route("https://tour.local/**", (r) => {
  const u = new URL(r.request().url());
  if (u.pathname === "/") return r.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
  if (u.pathname === "/audio.pcm") return r.fulfill({ contentType: "application/octet-stream", body: pcmBuf });
  if (u.pathname.startsWith("/img/")) return r.fulfill({ contentType: "image/jpeg", body: fs.readFileSync(path.join(outDir, path.basename(u.pathname))) });
  return r.fulfill({ status: 404, body: "" });
});
await page.goto("https://tour.local/");
await page.addScriptTag({ content: fs.readFileSync("node_modules/mp4-muxer/build/mp4-muxer.js", "utf8") });
await page.addScriptTag({ content: fs.readFileSync("scripts/_tour/renderer.js", "utf8") });
await page.evaluate(() => document.fonts.ready);
const chapterStarts = scenes.filter((s) => s.kind === "card").map((s) => ({ start: s.start }));
const cfg = {
  bitrate: 5_000_000,
  chapterStarts,
  scenes: scenes.map((s) => ({ kind: s.kind, dur: s.dur, chapter: s.chapter, image: s.image ?? null, focus: s.focus ?? null, callout: s.callout ?? null, click: !!s.click, zoom: s.zoom ?? 1.35, subs: s.subs })),
};
const started = Date.now();
const timer = setInterval(async () => {
  const p = await page.evaluate(() => window.__progress ?? 0).catch(() => null);
  if (p != null) console.log(`  rendering ${(p * 100).toFixed(0)}% (${((Date.now() - started) / 60000).toFixed(1)} min)`);
}, 30_000);
const result = await page.evaluate((c) => window.renderTour(c), cfg);
clearInterval(timer);
const fd = fs.openSync(outFile, "w");
for (let i = 0; i < result.bytes; i += 8 << 20) {
  const b64 = await page.evaluate(
    ([from, to]) => {
      const bytes = window.__mp4.subarray(from, to);
      let bin = "";
      for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
      return btoa(bin);
    },
    [i, Math.min(i + (8 << 20), result.bytes)],
  );
  fs.writeSync(fd, Buffer.from(b64, "base64"));
}
fs.closeSync(fd);
await browser.close();
console.log(`done: ${outFile} — ${(result.seconds / 60).toFixed(1)} min, ${(result.bytes / 1048576).toFixed(0)} MB, ${((Date.now() - started) / 60000).toFixed(1)} min to render`);
