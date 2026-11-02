// Product tour renderer: runs in a headless browser page (window.renderTour). Draws every frame
// on a 1920×1080 canvas — chapter cards, the app in a window with camera moves, spotlight,
// cursor, callouts and subtitles — encodes H.264 + AAC with WebCodecs and muxes an MP4 with
// mp4-muxer. Images are fetched from https://tour.local/img/…, the voice track from /audio.pcm.
(() => {
  const W = 1920;
  const H = 1080;
  const FPS = 30;
  const BRAND = "#6366f1";
  const BRAND2 = "#22d3ee";
  const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const back = (t) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const font = (px, weight = 400) => `${weight} ${px}px ${FONT}`;

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  }
  function text(t, x, y, px, color, weight = 400, align = "left", alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = font(px, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t, x, y);
    ctx.restore();
  }
  function wrap(t, maxW, px, weight = 400) {
    ctx.font = font(px, weight);
    const words = t.split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  // ── Static layers, drawn once ──
  const layer = (draw) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    draw(c.getContext("2d"));
    return c;
  };
  const backdrop = layer((c) => {
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#070b1f");
    g.addColorStop(0.55, "#0d1236");
    g.addColorStop(1, "#151a4a");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,0.045)";
    for (let x = 30; x < W; x += 48) for (let y = 30; y < H; y += 48) c.fillRect(x, y, 2, 2);
  });
  // The app window: centred, with a title bar.
  const WIN = { x: 150, y: 104, w: 1620, h: 911 + 40 };
  const VIEW = { x: WIN.x, y: WIN.y + 40, w: WIN.w, h: WIN.h - 40 };
  const windowFrame = layer((c) => {
    c.save();
    c.shadowColor = "rgba(0,0,0,0.55)";
    c.shadowBlur = 70;
    c.shadowOffsetY = 30;
    c.fillStyle = "#0f172a";
    rrect(c, WIN.x, WIN.y, WIN.w, WIN.h, 18);
    c.fill();
    c.restore();
    c.fillStyle = "#1e2440";
    rrect(c, WIN.x, WIN.y, WIN.w, 40, [18, 18, 0, 0]);
    c.fill();
    ["#ff5f57", "#febc2e", "#28c840"].forEach((col, i) => {
      c.fillStyle = col;
      c.beginPath();
      c.arc(WIN.x + 26 + i * 22, WIN.y + 20, 6.5, 0, Math.PI * 2);
      c.fill();
    });
  });

  // Floating soft lights in the backdrop.
  function lights(t, strength = 1) {
    const orbs = [
      [0.18, 0.25, 520, BRAND, 0.0],
      [0.82, 0.75, 600, BRAND2, 2.1],
      [0.6, 0.15, 380, "#a855f7", 4.2],
    ];
    for (const [fx, fy, r, col, ph] of orbs) {
      const x = W * fx + Math.sin(t * 0.25 + ph) * 120;
      const y = H * fy + Math.cos(t * 0.21 + ph) * 80;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col + "55");
      g.addColorStop(1, col + "00");
      ctx.globalAlpha = 0.55 * strength;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
  }

  // ── Pieces of the frame ──
  function chapterChip(ch, a) {
    if (!ch.number) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = font(22, 700);
    const label = `${String(ch.number).padStart(2, "0")}`;
    const title = ch.title;
    const w = ctx.measureText(title).width;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    rrect(ctx, 150, 40, w + 100, 50, 25);
    ctx.fill();
    ctx.fillStyle = BRAND;
    rrect(ctx, 156, 46, 56, 38, 19);
    ctx.fill();
    text(label, 184, 72, 20, "#fff", 800, "center");
    text(title, 226, 73, 22, "#fff", 700);
    ctx.restore();
    text("LeadLift", 1770, 74, 26, "#fff", 800, "right", a * 0.9);
    text("Product tour", 1770, 96, 15, "rgba(255,255,255,0.55)", 500, "right", a);
  }
  function progressBar(T, total, chapters, current) {
    const y = H - 13;
    const x0 = 150;
    const x1 = W - 150;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    rrect(ctx, x0, y, x1 - x0, 5, 3);
    ctx.fill();
    // Chapter ticks.
    for (const ch of chapters) {
      const x = x0 + (x1 - x0) * (ch.start / total);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x, y - 3, 2, 11);
    }
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, BRAND);
    g.addColorStop(1, BRAND2);
    ctx.fillStyle = g;
    rrect(ctx, x0, y, (x1 - x0) * clamp(T / total), 5, 3);
    ctx.fill();
    void current;
  }
  function subtitle(chunks, local) {
    const c = chunks.find((k) => local >= k.from && local < k.to);
    if (!c) return;
    const a = Math.min(seg(local, c.from, c.from + 0.18), 1 - seg(local, c.to - 0.15, c.to));
    const lines = wrap(c.text, 1300, 34, 600);
    const lh = 46;
    const h = lines.length * lh + 30;
    const widths = lines.map((l) => (ctx.font = font(34, 600), ctx.measureText(l).width));
    const w = Math.max(...widths) + 64;
    const y = H - 60 - h;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(7,11,31,0.86)";
    rrect(ctx, (W - w) / 2, y, w, h, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    lines.forEach((l, i) => text(l, W / 2, y + 22 + 34 + i * lh - 6, 34, "#fff", 600, "center"));
    ctx.restore();
  }
  function cursor(x, y, pressed) {
    ctx.save();
    ctx.translate(x, y);
    const s = pressed ? 0.88 : 1;
    ctx.scale(s * 1.5, s * 1.5);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 22);
    ctx.lineTo(6, 17);
    ctx.lineTo(10, 26);
    ctx.lineTo(14, 24);
    ctx.lineTo(10, 15.5);
    ctx.lineTo(17, 15.5);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#0b1130";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
  function callout(rect, title, body, a) {
    if (!title || a <= 0) return;
    const w = 470;
    const lines = wrap(body ?? "", w - 48, 24, 500);
    const h = 78 + lines.length * 32;
    // Beside the focus: right if there is room, else left, else below.
    let x = rect.x + rect.w + 40;
    let y = rect.y + rect.h / 2 - h / 2;
    let side = "right";
    if (x + w > W - 40) {
      x = rect.x - w - 40;
      side = "left";
    }
    if (x < 40) {
      x = Math.min(Math.max(rect.x + rect.w / 2 - w / 2, 40), W - w - 40);
      y = rect.y + rect.h + 34;
      side = "below";
      if (y + h > H - 160) {
        y = rect.y - h - 34;
        side = "above";
      }
    }
    y = Math.min(Math.max(y, 110), H - 170 - h);
    const dx = (1 - a) * (side === "right" ? -30 : side === "left" ? 30 : 0);
    const dy = (1 - a) * (side === "below" ? -20 : side === "above" ? 20 : 0);
    ctx.save();
    ctx.globalAlpha = a;
    // Connector.
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([2, 7]);
    ctx.lineCap = "round";
    ctx.beginPath();
    const ax = side === "right" ? rect.x + rect.w : side === "left" ? rect.x : rect.x + rect.w / 2;
    const ay = side === "below" ? rect.y + rect.h : side === "above" ? rect.y : rect.y + rect.h / 2;
    const bx = side === "right" ? x : side === "left" ? x + w : x + w / 2;
    const by = side === "below" ? y : side === "above" ? y + h : y + h / 2;
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx + dx, by + dy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.translate(dx, dy);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#eef2ff");
    ctx.fillStyle = g;
    rrect(ctx, x, y, w, h, 20);
    ctx.fill();
    ctx.shadowColor = "transparent";
    const bar = ctx.createLinearGradient(x, y, x, y + h);
    bar.addColorStop(0, BRAND);
    bar.addColorStop(1, BRAND2);
    ctx.fillStyle = bar;
    rrect(ctx, x, y, 8, h, [20, 0, 0, 20]);
    ctx.fill();
    text(title, x + 30, y + 46, 28, "#0b1130", 800);
    lines.forEach((l, i) => text(l, x + 30, y + 84 + i * 32, 24, "#475569", 500));
    ctx.restore();
  }

  // ── Scene drawers ──
  function drawCard(sc, local, T) {
    ctx.drawImage(backdrop, 0, 0);
    lights(T, 1.4);
    const a = seg(local, 0, 0.5);
    const out = 1 - seg(local, sc.dur - 0.45, sc.dur);
    const k = Math.min(a, out);
    if (sc.kind === "intro") return drawIntro(sc, local, k);
    if (sc.kind === "outro") return drawOutro(sc, local, k);
    // Big outlined number sliding in.
    ctx.save();
    ctx.globalAlpha = 0.16 * k;
    ctx.font = font(520, 900);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.textAlign = "right";
    ctx.strokeText(String(sc.chapter.number).padStart(2, "0"), W - 120 + (1 - easeOut(seg(local, 0, 1.2))) * 200, 760);
    ctx.restore();
    const e = easeOut(seg(local, 0.15, 0.9));
    ctx.save();
    ctx.globalAlpha = k;
    const badge = `CHAPTER ${sc.chapter.number}`;
    ctx.font = font(20, 800);
    const bw = ctx.measureText(badge).width + 44;
    ctx.fillStyle = BRAND;
    rrect(ctx, 200, 360 - 20 * (1 - e), bw, 52, 26);
    ctx.fill();
    text(badge, 200 + bw / 2, 394 - 20 * (1 - e), 20, "#fff", 800, "center");
    const titleLines = wrap(sc.chapter.title, 1300, 110, 800);
    titleLines.forEach((l, i) => text(l, 200 - 60 * (1 - e), 520 + i * 118, 110, "#fff", 800));
    const e2 = easeOut(seg(local, 0.5, 1.3));
    const sub = sc.chapter.subtitle ?? "";
    const lineY = 520 + (titleLines.length - 1) * 118 + 34;
    text(sub, 204, lineY + 64 + 20 * (1 - e2), 38, "rgba(255,255,255,0.78)", 500, "left", e2);
    // A light sweep under the title.
    const sw = easeOut(seg(local, 0.3, 1.4));
    const lg = ctx.createLinearGradient(200, 0, 200 + 900 * sw, 0);
    lg.addColorStop(0, BRAND2);
    lg.addColorStop(1, BRAND + "00");
    ctx.fillStyle = lg;
    ctx.fillRect(200, lineY, 900 * sw, 5);
    ctx.restore();
    // Upcoming step count chips.
    ctx.save();
    ctx.globalAlpha = k * easeOut(seg(local, 0.9, 1.6));
    text(`${sc.chapter.steps} step${sc.chapter.steps === 1 ? "" : "s"} · ${sc.chapter.number} of ${sc.chapter.of}`, 204, 900, 26, "rgba(255,255,255,0.55)", 600);
    ctx.restore();
  }
  function logo(x, y, size, a) {
    ctx.save();
    ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, "#818cf8");
    g.addColorStop(1, "#4f46e5");
    ctx.fillStyle = g;
    ctx.shadowColor = "rgba(99,102,241,0.6)";
    ctx.shadowBlur = 50;
    rrect(ctx, x, y, size, size, size * 0.24);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = size * 0.09;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x + size * 0.3, y + size * 0.25);
    ctx.lineTo(x + size * 0.3, y + size * 0.72);
    ctx.lineTo(x + size * 0.72, y + size * 0.72);
    ctx.moveTo(x + size * 0.48, y + size * 0.52);
    ctx.lineTo(x + size * 0.74, y + size * 0.26);
    ctx.moveTo(x + size * 0.56, y + size * 0.26);
    ctx.lineTo(x + size * 0.74, y + size * 0.26);
    ctx.lineTo(x + size * 0.74, y + size * 0.44);
    ctx.stroke();
    ctx.restore();
  }
  function drawIntro(sc, local, k) {
    const s = back(seg(local, 0.2, 1.1));
    const size = 170 * s;
    logo(W / 2 - size / 2, 300 - size / 2 + 40, size, k);
    // The name, letter by letter.
    const name = "LeadLift";
    ctx.font = font(130, 800);
    const total = ctx.measureText(name).width;
    let x = W / 2 - total / 2;
    for (const [i, ch] of [...name].entries()) {
      const a = easeOut(seg(local, 0.9 + i * 0.07, 1.4 + i * 0.07));
      const wch = (ctx.font = font(130, 800), ctx.measureText(ch).width);
      text(ch, x, 600 + 40 * (1 - a), 130, i >= 4 ? "#a5b4fc" : "#fff", 800, "left", a * k);
      x += wch;
    }
    const t2 = easeOut(seg(local, 1.8, 2.6));
    text(sc.chapter.subtitle, W / 2, 680 + 20 * (1 - t2), 40, "rgba(255,255,255,0.8)", 500, "center", t2 * k);
    const t3 = easeOut(seg(local, 2.6, 3.3));
    ctx.save();
    ctx.globalAlpha = t3 * k;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    rrect(ctx, W / 2 - 260, 740, 520, 56, 28);
    ctx.fill();
    text(`Product tour · ${sc.chapter.of} chapters`, W / 2, 777, 24, "#c7d2fe", 700, "center");
    ctx.restore();
  }
  function drawOutro(sc, local, k) {
    const steps = ["Audit", "Proposal", "Follow-up", "Client", "Report"];
    const t1 = easeOut(seg(local, 0.1, 0.8));
    text(sc.chapter.title, W / 2, 330 + 30 * (1 - t1), 110, "#fff", 800, "center", t1 * k);
    const bw = 230;
    const gap = 70;
    const x0 = W / 2 - (steps.length * bw + (steps.length - 1) * gap) / 2;
    steps.forEach((label, i) => {
      const a = back(seg(local, 0.8 + i * 0.35, 1.3 + i * 0.35));
      const x = x0 + i * (bw + gap);
      ctx.save();
      ctx.globalAlpha = clamp(a) * k;
      ctx.translate(x + bw / 2, 500);
      ctx.scale(0.6 + 0.4 * a, 0.6 + 0.4 * a);
      const g = ctx.createLinearGradient(-bw / 2, -50, bw / 2, 50);
      g.addColorStop(0, i % 2 ? "#4f46e5" : "#6366f1");
      g.addColorStop(1, i % 2 ? "#0891b2" : "#7c3aed");
      ctx.fillStyle = g;
      ctx.shadowColor = "rgba(99,102,241,0.5)";
      ctx.shadowBlur = 30;
      rrect(ctx, -bw / 2, -50, bw, 100, 24);
      ctx.fill();
      ctx.shadowColor = "transparent";
      text(label, 0, 12, 34, "#fff", 800, "center");
      ctx.restore();
      if (i < steps.length - 1) {
        const ar = easeOut(seg(local, 1.2 + i * 0.35, 1.5 + i * 0.35));
        ctx.save();
        ctx.globalAlpha = ar * k;
        ctx.strokeStyle = "#a5b4fc";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        const ax = x + bw + 12;
        ctx.beginPath();
        ctx.moveTo(ax, 500);
        ctx.lineTo(ax + (gap - 24) * ar, 500);
        ctx.lineTo(ax + (gap - 24) * ar - 10, 490);
        ctx.moveTo(ax + (gap - 24) * ar, 500);
        ctx.lineTo(ax + (gap - 24) * ar - 10, 510);
        ctx.stroke();
        ctx.restore();
      }
    });
    const t3 = easeOut(seg(local, 3, 3.8));
    logo(W / 2 - 50, 650, 100 * t3, t3 * k);
    text("LeadLift", W / 2, 820, 54, "#fff", 800, "center", t3 * k);
    text("Win SEO clients. Keep them.", W / 2, 872, 28, "rgba(255,255,255,0.7)", 500, "center", t3 * k);
  }

  // The app view: screenshot inside the window, with camera, spotlight, cursor and callout.
  function drawStep(sc, local, T, img, prevImg, fromPrev) {
    ctx.drawImage(backdrop, 0, 0);
    lights(T, 0.9);
    ctx.drawImage(windowFrame, 0, 0);
    const scale = VIEW.w / 1920;
    // Camera: zoom towards the focus after a short look at the whole page.
    let zoom = 1;
    let cx = 960;
    let cy = 540;
    if (sc.focus) {
      const z = ease(seg(local, 0.7, 1.9));
      const target = Math.min(sc.zoom ?? 1.35, 1920 / Math.max(sc.focus.w + 260, 1), 1080 / Math.max(sc.focus.h + 260, 1));
      const zt = Math.max(1.05, target);
      zoom = lerp(1, zt, z);
      const fx = sc.focus.x + sc.focus.w / 2;
      const fy = sc.focus.y + sc.focus.h / 2;
      cx = lerp(960, fx, z);
      cy = lerp(540, fy, z);
    } else {
      zoom = 1 + 0.035 * seg(local, 0, sc.dur);
    }
    // Keep the screenshot covering the view.
    const halfW = 960 / zoom;
    const halfH = 540 / zoom;
    cx = clamp(cx, halfW, 1920 - halfW);
    cy = clamp(cy, halfH, 1080 - halfH);
    const toScreen = (x, y) => ({ x: VIEW.x + ((x - cx) * zoom + 960) * scale, y: VIEW.y + ((y - cy) * zoom + 540) * scale });
    ctx.save();
    rrect(ctx, VIEW.x, VIEW.y, VIEW.w, VIEW.h, [0, 0, 18, 18]);
    ctx.clip();
    const p = toScreen(0, 0);
    if (img) ctx.drawImage(img, p.x, p.y, 1920 * zoom * scale, 1080 * zoom * scale);
    // Cross-fade from the previous step of the same chapter.
    if (fromPrev && prevImg) {
      const f = 1 - seg(local, 0, 0.5);
      if (f > 0) {
        ctx.globalAlpha = f;
        ctx.drawImage(prevImg, VIEW.x, VIEW.y, VIEW.w, VIEW.h);
        ctx.globalAlpha = 1;
      }
    }
    // Spotlight on the focus.
    if (sc.focus) {
      const s = seg(local, 1.5, 2.1);
      if (s > 0) {
        const a = toScreen(sc.focus.x - 10, sc.focus.y - 10);
        const b = toScreen(sc.focus.x + sc.focus.w + 10, sc.focus.y + sc.focus.h + 10);
        const r = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        ctx.fillStyle = `rgba(5,8,25,${0.5 * s})`;
        ctx.beginPath();
        ctx.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
        ctx.roundRect(r.x, r.y, r.w, r.h, 14);
        ctx.fill("evenodd");
        const pulse = 0.6 + 0.4 * Math.sin(local * 3.2);
        ctx.strokeStyle = `rgba(129,140,248,${s * pulse})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = BRAND;
        ctx.shadowBlur = 24 * s;
        rrect(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.stroke();
        ctx.shadowBlur = 0;
        sc._rect = r;
      }
    }
    ctx.restore();
    // Cursor travels to the focus and clicks.
    if (sc.focus && sc.click) {
      const m = ease(seg(local, 1.2, 2.3));
      const c = toScreen(sc.focus.x + Math.min(sc.focus.w * 0.5, 160), sc.focus.y + sc.focus.h * 0.55);
      const x = lerp(W * 0.7, c.x, m);
      const y = lerp(H * 0.85, c.y, m);
      const clickAt = 2.45;
      if (local > clickAt && local < clickAt + 0.6) {
        const r = seg(local, clickAt, clickAt + 0.6);
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - r)})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 12 + 46 * easeOut(r), 0, Math.PI * 2);
        ctx.stroke();
      }
      cursor(x, y, local > clickAt && local < clickAt + 0.18);
    }
    if (sc.callout && sc._rect) callout(sc._rect, sc.callout.title, sc.callout.text, easeOut(seg(local, 2.0, 2.6)));
  }

  window.renderTour = async function renderTour(cfg) {
    const scenes = cfg.scenes;
    const total = scenes.reduce((s, x) => s + x.dur, 0);
    let start = 0;
    for (const s of scenes) {
      s.start = start;
      start += s.dur;
    }
    const chapters = cfg.chapterStarts;
    const frames = Math.round(total * FPS);
    const M = window.Mp4Muxer;
    const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: FPS }, audio: { codec: "aac", numberOfChannels: 1, sampleRate: 48000 }, fastStart: "in-memory" });
    let failure = null;
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failure = e) });
    enc.configure({ codec: "avc1.640028", width: W, height: H, bitrate: cfg.bitrate ?? 5_000_000, framerate: FPS, avc: { format: "avc" } });

    const cache = new Map();
    const image = async (name) => {
      if (!name) return null;
      if (!cache.has(name)) cache.set(name, createImageBitmap(await (await fetch(`https://tour.local/img/${name}`)).blob()));
      return cache.get(name);
    };
    let idx = 0;
    for (let f = 0; f < frames; f++) {
      if (failure) throw failure;
      const T = f / FPS;
      while (idx < scenes.length - 1 && T >= scenes[idx].start + scenes[idx].dur) {
        // Free the image of a scene two steps back.
        const old = scenes[idx - 1]?.image;
        if (old && !scenes.slice(idx, idx + 3).some((s) => s.image === old) && cache.has(old)) {
          (await cache.get(old)).close();
          cache.delete(old);
        }
        idx++;
      }
      const sc = scenes[idx];
      const local = T - sc.start;
      if (sc.kind === "step") {
        const prev = scenes[idx - 1];
        drawStep(sc, local, T, await image(sc.image), prev?.kind === "step" ? await image(prev.image) : null, prev?.kind === "step");
        chapterChip(sc.chapter, 1);
      } else drawCard(sc, local, T);
      // Fade between a card and the steps.
      const edge = Math.min(local, sc.dur - local);
      const fadeIn = sc.kind !== "step" || scenes[idx - 1]?.kind !== "step";
      if (fadeIn && edge < 0.35 && !(f === 0)) {
        ctx.fillStyle = `rgba(4,6,20,${(1 - edge / 0.35) * 0.9})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (sc.kind === "step" || sc.kind === "card") progressBar(T, total, chapters, sc.chapter);
      subtitle(sc.subs, local);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      if (f % 300 === 0) window.__progress = f / frames;
    }
    await enc.flush();
    if (failure) throw failure;

    // Voice and music track.
    const pcm = new Int16Array(await (await fetch("https://tour.local/audio.pcm")).arrayBuffer());
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failure = e) });
    aenc.configure({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 1, bitrate: 128000 });
    const length = Math.min(pcm.length, Math.round(total * 48000));
    for (let i = 0; i < length; i += 48000) {
      const part = pcm.slice(i, Math.min(i + 48000, length));
      const data = new AudioData({ format: "s16", sampleRate: 48000, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round((i * 1e6) / 48000), data: part });
      aenc.encode(data);
      data.close();
      while (aenc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
    }
    await aenc.flush();
    if (failure) throw failure;
    muxer.finalize();
    window.__mp4 = new Uint8Array(muxer.target.buffer);
    return { bytes: window.__mp4.length, seconds: total };
  };
})();
