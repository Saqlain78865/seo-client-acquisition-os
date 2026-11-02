/**
 * Runs inside a headless browser page (passed to page.evaluate, so it must not use anything from
 * outside this function). Draws the audit video frame by frame on a canvas and encodes it as an
 * H.264 MP4 with WebCodecs and mp4-muxer (window.Mp4Muxer). Returns the file as base64.
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
  counts: { critical: number; high: number; medium: number; total: number };
  contact: string[];
};

export async function renderAuditVideo(s: VideoScript): Promise<{ base64: string; seconds: number }> {
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
    const w = img.width * sc;
    const h = img.height * sc;
    ctx.drawImage(img, (W - w) / 2, 0, w, h);
  };
  const brandBg = () => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0b1130");
    g.addColorStop(1, s.brand);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  const enter = (t: number, delay: number) => ease(clamp((t - delay) / 0.6));

  type Scene = { dur: number; draw: (t: number, local: number) => void };
  const scenes: Scene[] = [];

  scenes.push({
    dur: 4,
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
      text(`Prepared by ${s.preparedBy} · ${s.dateLabel}`, 90, 620, 22, "rgba(255,255,255,.7)");
      ctx.globalAlpha = 1;
    },
  });

  if (full) {
    const sc = W / full.width;
    const maxOff = Math.max(0, Math.min(full.height * sc - (H - 76), 2600));
    scenes.push({
      dur: 9,
      draw: (t, local) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, W, H);
        const off = maxOff * ease(clamp((local - 0.8) / (9 - 1.8)));
        ctx.drawImage(full, 0, -off, W, full.height * sc);
        ctx.fillStyle = "rgba(11,17,48,.92)";
        ctx.fillRect(0, H - 76, W, 76);
        text("Your website today", 40, H - 30, 26, "#fff", 700);
        text(s.domain, W - 40, H - 30, 22, "rgba(255,255,255,.75)", 500, "right");
      },
    });
  } else if (desktop) {
    scenes.push({
      dur: 6,
      draw: (t, local) => {
        cover(desktop, 1 + local * 0.01);
        ctx.fillStyle = "rgba(11,17,48,.92)";
        ctx.fillRect(0, H - 76, W, 76);
        text("Your website today", 40, H - 30, 26, "#fff", 700);
      },
    });
  }

  if (mobile) {
    scenes.push({
      dur: 5,
      draw: (t, local) => {
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
        const off = Math.max(0, mobile.height * sc - ph) * ease(clamp((local - 0.5) / 4));
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
    scenes.push({
      dur: 6.5,
      draw: (t, local) => {
        ctx.fillStyle = "#0b1130";
        ctx.fillRect(0, 0, W, H);
        if (img) cover(img, 1 + local * 0.008);
        const g = ctx.createLinearGradient(0, 0, W * 0.75, 0);
        g.addColorStop(0, "rgba(11,17,48,.96)");
        g.addColorStop(0.55, "rgba(11,17,48,.88)");
        g.addColorStop(1, "rgba(11,17,48,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const a = enter(t, 0.15);
        ctx.globalAlpha = a;
        const x = 70 - 30 * (1 - a);
        text(`PROBLEM ${i + 1} OF ${s.issues.length}`, x, 130, 20, "rgba(255,255,255,.7)", 700);
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
          text("HOW WE FIX IT", x, y + 40, 18, s.brand === "#4f46e5" ? "#a5b4fc" : "#fde68a", 700);
          para(issue.fix, x, y + 72, 22, "rgba(255,255,255,.8)", 600, 3);
        }
        ctx.globalAlpha = 1;
      },
    });
  });

  scenes.push({
    dur: 5,
    draw: (t) => {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, W, H);
      text(`${s.counts.total} issue${s.counts.total === 1 ? "" : "s"} found on ${s.domain}`, 90, 170, 46, "#0f172a", 800);
      const rows: [string, number, string][] = [
        ["Critical", s.counts.critical, "#dc2626"],
        ["High impact", s.counts.high, "#ea580c"],
        ["Medium", s.counts.medium, "#d97706"],
      ];
      const max = Math.max(1, ...rows.map((r) => r[1]));
      rows.forEach(([label, n, col], i) => {
        const a = enter(t, 0.3 + i * 0.25);
        const y = 260 + i * 90;
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
      text("Fixing these helps more customers find you on Google — and contact you.", 90, 600, 26, "#334155", 500);
      ctx.globalAlpha = 1;
    },
  });

  scenes.push({
    dur: 6,
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
  const M = (window as unknown as { Mp4Muxer: { Muxer: new (o: unknown) => { addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void; finalize: () => void; target: { buffer: ArrayBuffer } }; ArrayBufferTarget: new () => unknown } }).Mp4Muxer;
  const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: s.fps }, fastStart: "in-memory" });
  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 1_800_000, framerate: s.fps, avc: { format: "avc" } });

  for (let f = 0; f < frames; f++) {
    if (failure) throw failure;
    const time = f / s.fps;
    let start = 0;
    let scene = scenes[scenes.length - 1];
    for (const sc of scenes) {
      if (time < start + sc.dur) {
        scene = sc;
        break;
      }
      start += sc.dur;
    }
    const local = time - start;
    ctx.save();
    scene.draw(local, local);
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
  muxer.finalize();
  const bytes = new Uint8Array(muxer.target.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), seconds: Math.round(total) };
}
