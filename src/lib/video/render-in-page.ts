/**
 * Runs inside a headless browser page (passed to page.evaluate, so it must not use anything from
 * outside this function). Draws the audit video frame by frame on a canvas, encodes it as H.264
 * with WebCodecs, adds the voice-over (AAC) when one was prepared, and muxes an MP4 with
 * mp4-muxer (window.Mp4Muxer). The file is left in window.__mp4 for the server to read in parts.
 */

export type VideoScript = {
  width: number;
  height: number;
  fps: number;
  brand: string;
  business: string;
  domain: string;
  preparedBy: string;
  dateLabel: string;
  images: { full: string | null; desktop: string | null; mobile: string | null; findings: (string | null)[] };
  issues: { title: string; impact: string; fix: string; severity: string }[];
  /** Smaller issues, shown as lists (a few per screen). */
  minor: string[][];
  counts: { critical: number; high: number; medium: number; low: number; total: number };
  contact: string[];
  /** Seconds per scene, in the order the scenes are drawn (follows the voice-over); defaults otherwise. */
  durations: number[] | null;
  /** Voice-over samples are in window.__pcm (Int16, 48 kHz mono) when true. */
  audio: boolean;
};

export async function renderAuditVideo(s: VideoScript): Promise<{ bytes: number; seconds: number }> {
  const W = s.width;
  const H = s.height;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const font = (px: number, weight = 400) => `${weight} ${px}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  const load = async (src: string | null) => (src ? createImageBitmap(await (await fetch(src)).blob()) : null);
  const full = await load(s.images.full);
  const desktop = await load(s.images.desktop);
  const mobile = await load(s.images.mobile);
  const findingImgs = await Promise.all(s.images.findings.map(load));
  const sevColor: Record<string, string> = { CRITICAL: "#dc2626", HIGH: "#ea580c", MEDIUM: "#d97706", LOW: "#2563eb" };
  const sevLabel: Record<string, string> = { CRITICAL: "Critical", HIGH: "High impact", MEDIUM: "Medium", LOW: "Low" };

  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const wrap = (text: string, maxW: number, maxLines: number) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
        if (lines.length === maxLines) break;
      } else line = test;
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return lines;
  };
  const text = (t: string, x: number, y: number, px: number, color: string, weight = 400, align: CanvasTextAlign = "left") => {
    ctx.font = font(px, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
  };
  const para = (t: string, x: number, y: number, px: number, color: string, maxW: number, maxLines: number, weight = 400, lh = 1.3) => {
    ctx.font = font(px, weight);
    const lines = wrap(t, maxW, maxLines);
    lines.forEach((l, i) => text(l, x, y + i * px * lh, px, color, weight));
    return y + lines.length * px * lh;
  };
  const rrect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  const cover = (img: ImageBitmap, zoom: number) => {
    const sc = Math.max(W / img.width, H / img.height) * zoom;
    ctx.drawImage(img, (W - img.width * sc) / 2, 0, img.width * sc, img.height * sc);
  };
  const brandBg = () => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0b1130");
    g.addColorStop(1, s.brand);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  const enter = (t: number, delay: number) => ease(clamp((t - delay) / 0.6));
  // Scene lengths follow the voice-over when there is one.
  let sceneNo = 0;
  const dur = (fallback: number) => s.durations?.[sceneNo++] ?? fallback;

  type Scene = { dur: number; draw: (t: number) => void };
  const scenes: Scene[] = [];

  scenes.push({
    dur: dur(4),
    draw: (t) => {
      brandBg();
      const a = enter(t, 0.1);
      ctx.globalAlpha = a;
      text("WEBSITE REVIEW", 90, 230 - 20 * (1 - a), 22, "rgba(255,255,255,.75)", 600);
      ctx.globalAlpha = enter(t, 0.35);
      ctx.font = font(64, 800);
      wrap(s.business, W - 180, 2).forEach((l, i) => text(l, 90, 310 + i * 76, 64, "#fff", 800));
      ctx.globalAlpha = enter(t, 0.7);
      text(s.domain, 90, 470, 30, "rgba(255,255,255,.85)", 500);
      text(`${s.counts.total} issue${s.counts.total === 1 ? "" : "s"} found · prepared by ${s.preparedBy} · ${s.dateLabel}`, 90, 620, 22, "rgba(255,255,255,.7)");
      ctx.globalAlpha = 1;
    },
  });

  if (full || desktop) {
    const d = dur(full ? 9 : 6);
    const sc = full ? W / full.width : 1;
    const maxOff = full ? Math.max(0, Math.min(full.height * sc - (H - 76), 2600)) : 0;
    scenes.push({
      dur: d,
      draw: (t) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, W, H);
        if (full) ctx.drawImage(full, 0, -maxOff * ease(clamp((t - 0.8) / Math.max(d - 1.8, 1))), W, full.height * sc);
        else if (desktop) cover(desktop, 1 + t * 0.01);
        ctx.fillStyle = "rgba(11,17,48,.92)";
        ctx.fillRect(0, H - 76, W, 76);
        text("Your website today", 40, H - 30, 26, "#fff", 700);
        text(s.domain, W - 40, H - 30, 22, "rgba(255,255,255,.75)", 500, "right");
      },
    });
  }

  if (mobile) {
    const d = dur(5);
    scenes.push({
      dur: d,
      draw: (t) => {
        ctx.fillStyle = "#0b1130";
        ctx.fillRect(0, 0, W, H);
        const pw = 300;
        const ph = 620;
        const px = 170;
        const py = (H - ph) / 2;
        ctx.fillStyle = "#1e293b";
        rrect(px - 12, py - 12, pw + 24, ph + 24, 40);
        ctx.fill();
        ctx.save();
        rrect(px, py, pw, ph, 28);
        ctx.clip();
        const sc = pw / mobile.width;
        const off = Math.max(0, mobile.height * sc - ph) * ease(clamp((t - 0.5) / Math.max(d - 1, 1)));
        ctx.fillStyle = "#fff";
        ctx.fillRect(px, py, pw, ph);
        ctx.drawImage(mobile, px, py - off, pw, mobile.height * sc);
        ctx.restore();
        ctx.globalAlpha = enter(t, 0.3);
        text("On a phone", 580, 300, 54, "#fff", 800);
        para("This is how customers see the website when they search on their phone.", 580, 370, 28, "rgba(255,255,255,.8)", 600, 3);
        ctx.globalAlpha = 1;
      },
    });
  }

  s.issues.forEach((issue, i) => {
    const img = findingImgs[i] ?? desktop ?? full;
    const d = dur(6.5);
    scenes.push({
      dur: d,
      draw: (t) => {
        ctx.fillStyle = "#0b1130";
        ctx.fillRect(0, 0, W, H);
        if (img) cover(img, 1 + (t / d) * 0.06);
        const g = ctx.createLinearGradient(0, 0, W * 0.75, 0);
        g.addColorStop(0, "rgba(11,17,48,.98)");
        g.addColorStop(0.62, "rgba(11,17,48,.95)");
        g.addColorStop(1, "rgba(11,17,48,.15)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const a = enter(t, 0.15);
        ctx.globalAlpha = a;
        const x = 70 - 30 * (1 - a);
        text(`ISSUE ${i + 1} OF ${s.issues.length}`, x, 130, 20, "rgba(255,255,255,.7)", 700);
        const col = sevColor[issue.severity] ?? "#d97706";
        ctx.font = font(18, 700);
        const label = (sevLabel[issue.severity] ?? issue.severity).toUpperCase();
        const lw = ctx.measureText(label).width + 28;
        ctx.fillStyle = col;
        rrect(x, 150, lw, 34, 17);
        ctx.fill();
        text(label, x + 14, 173, 18, "#fff", 700);
        let y = para(issue.title, x, 245, 40, "#fff", 600, 3, 800, 1.2);
        ctx.globalAlpha = enter(t, 0.6);
        if (issue.impact) y = para(issue.impact, x, y + 24, 24, "rgba(255,255,255,.85)", 600, 4);
        ctx.globalAlpha = enter(t, 1.1);
        if (issue.fix) {
          text("HOW WE FIX IT", x, y + 40, 18, "#fde68a", 700);
          para(issue.fix, x, y + 72, 22, "rgba(255,255,255,.8)", 600, 3);
        }
        ctx.globalAlpha = 1;
        // Progress through the issues.
        ctx.fillStyle = "rgba(255,255,255,.15)";
        ctx.fillRect(0, H - 6, W, 6);
        ctx.fillStyle = s.brand;
        ctx.fillRect(0, H - 6, (W * (i + clamp(t / d))) / s.issues.length, 6);
      },
    });
  });

  s.minor.forEach((group, gi) => {
    scenes.push({
      dur: dur(6),
      draw: (t) => {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(0, 0, W, H);
        text(s.minor.length > 1 ? `Smaller fixes (${gi + 1} of ${s.minor.length})` : "Smaller fixes", 90, 140, 44, "#0f172a", 800);
        group.forEach((item, i) => {
          ctx.globalAlpha = enter(t, 0.2 + i * 0.25);
          ctx.fillStyle = sevColor.LOW;
          ctx.beginPath();
          ctx.arc(102, 214 + i * 74, 9, 0, Math.PI * 2);
          ctx.fill();
          para(item, 130, 224 + i * 74, 26, "#334155", 1060, 1, 500);
        });
        ctx.globalAlpha = 1;
      },
    });
  });

  scenes.push({
    dur: dur(5),
    draw: (t) => {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, W, H);
      text(`${s.counts.total} issue${s.counts.total === 1 ? "" : "s"} found on ${s.domain}`, 90, 170, 46, "#0f172a", 800);
      const rows: [string, number, string][] = [
        ["Critical", s.counts.critical, "#dc2626"],
        ["High impact", s.counts.high, "#ea580c"],
        ["Medium", s.counts.medium, "#d97706"],
        ["Smaller fixes", s.counts.low, "#2563eb"],
      ];
      const max = Math.max(1, ...rows.map((r) => r[1]));
      rows.forEach(([label, n, col], i) => {
        const a = enter(t, 0.3 + i * 0.25);
        const y = 240 + i * 80;
        text(label, 90, y + 32, 26, "#334155", 600);
        ctx.fillStyle = "#e2e8f0";
        rrect(330, y, 700, 44, 10);
        ctx.fill();
        ctx.fillStyle = col;
        rrect(330, y, Math.max(44, (700 * n * a) / max), 44, 10);
        ctx.fill();
        text(String(n), 1060, y + 32, 28, "#0f172a", 800);
      });
      ctx.globalAlpha = enter(t, 1.3);
      text("Every one of these can be fixed — and fixing them helps customers find and contact you.", 90, 620, 24, "#334155", 500);
      ctx.globalAlpha = 1;
    },
  });

  scenes.push({
    dur: dur(6),
    draw: (t) => {
      brandBg();
      ctx.globalAlpha = enter(t, 0.1);
      text("Want these fixed?", 90, 220, 60, "#fff", 800);
      ctx.globalAlpha = enter(t, 0.5);
      text(s.preparedBy, 90, 310, 34, "#fff", 700);
      s.contact.slice(0, 4).forEach((c, i) => text(c, 90, 370 + i * 46, 28, "rgba(255,255,255,.88)", 500));
      ctx.globalAlpha = enter(t, 1.2);
      text("Reply to this message for the full report — free, no obligation.", 90, 640, 24, "rgba(255,255,255,.75)", 500);
      ctx.globalAlpha = 1;
    },
  });

  const total = scenes.reduce((a, sc) => a + sc.dur, 0);
  const frames = Math.round(total * s.fps);
  type Muxer = { addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void; addAudioChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void; finalize: () => void; target: { buffer: ArrayBuffer } };
  const M = (window as unknown as { Mp4Muxer: { Muxer: new (o: unknown) => Muxer; ArrayBufferTarget: new () => unknown } }).Mp4Muxer;
  const pcm = s.audio ? (window as unknown as { __pcm?: Int16Array }).__pcm : undefined;
  const muxer = new M.Muxer({
    target: new M.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: s.fps },
    ...(pcm ? { audio: { codec: "aac", numberOfChannels: 1, sampleRate: 48000 } } : {}),
    fastStart: "in-memory",
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 1_300_000, framerate: s.fps, avc: { format: "avc" } });

  let start = 0;
  let idx = 0;
  for (let f = 0; f < frames; f++) {
    if (failure) throw failure;
    const time = f / s.fps;
    while (idx < scenes.length - 1 && time >= start + scenes[idx].dur) start += scenes[idx++].dur;
    const scene = scenes[idx];
    const local = time - start;
    ctx.save();
    scene.draw(local);
    ctx.restore();
    // A short fade between scenes.
    const edge = Math.min(local, scene.dur - local);
    if (edge < 0.25) {
      ctx.fillStyle = `rgba(0,0,0,${(1 - edge / 0.25) * 0.85})`;
      ctx.fillRect(0, 0, W, H);
    }
    const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / s.fps), duration: Math.round(1e6 / s.fps) });
    encoder.encode(frame, { keyFrame: f % (s.fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
  }
  await encoder.flush();
  if (failure) throw failure;

  if (pcm) {
    const audio = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
    audio.configure({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 1, bitrate: 96000 });
    const length = Math.min(pcm.length, Math.round(total * 48000));
    for (let i = 0; i < length; i += 48000) {
      const part = pcm.slice(i, Math.min(i + 48000, length));
      const data = new AudioData({ format: "s16", sampleRate: 48000, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round((i * 1e6) / 48000), data: part });
      audio.encode(data);
      data.close();
      while (audio.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    }
    await audio.flush();
    if (failure) throw failure;
  }
  muxer.finalize();
  const bytes = new Uint8Array(muxer.target.buffer);
  (window as unknown as { __mp4: Uint8Array }).__mp4 = bytes;
  return { bytes: bytes.length, seconds: Math.round(total) };
}
