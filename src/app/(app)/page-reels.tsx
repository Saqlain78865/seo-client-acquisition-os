"use client";

import { BellRing, Check, FileText, Globe, Layers, Mail, MapPin, Send, Star, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/whatsapp-button";
import { CountUp, Reel, type ReelScene } from "./hero-reel";

/**
 * Short motion-graphics loops for the Bulk audit, New audit and Prospects pages, in the same style
 * as the Overview reel. Decoration only: names and numbers are illustrative, not workspace data.
 */

const v = (vars: Record<string, string | number>) => vars as React.CSSProperties;
const Chip = ({ children, delay, className }: { children: React.ReactNode; delay: number; className?: string }) => (
  <span className={cn("reel-rise rounded-full bg-white/8 px-3 py-1 text-[11px] text-white/75 ring-1 ring-white/10", className)} style={{ animationDelay: `${delay}s` }}>
    {children}
  </span>
);

/** Keeps each scene in the middle of the reel, whatever its height. */
const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-1 items-center">
    <div className="w-full">{children}</div>
  </div>
);

// ───────────────────────────── Bulk audit ─────────────────────────────

const BULK_SCENES: ReelScene[] = [
  { key: "list", label: "Paste", title: "Paste a list of websites" },
  { key: "run", label: "Audit", title: "Audited three at a time" },
  { key: "rank", label: "Rank", title: "Ranked by opportunity" },
  { key: "send", label: "Send", title: "Proposals out in one go" },
];
const SITES = ["desertsafari.ae", "smiledental.co.uk", "citymovers.com", "balloonrides.ae", "fixmyroof.com"];

function BulkScene({ k }: { k: string }) {
  if (k === "list")
    return (
      <div className="mx-auto max-w-sm space-y-1.5 py-1">
        {SITES.map((s, i) => (
          <div key={s} className="reel-slide flex items-center gap-2 rounded-lg bg-white/8 px-3 py-1.5 font-mono text-xs ring-1 ring-white/10" style={{ animationDelay: `${0.15 + i * 0.25}s` }}>
            <Globe className="h-3.5 w-3.5 text-white/50" /> {s}
          </div>
        ))}
      </div>
    );
  if (k === "run")
    return (
      <div className="mx-auto max-w-md space-y-3 py-2">
        {SITES.slice(0, 3).map((s, i) => (
          <div key={s} className="reel-rise" style={{ animationDelay: `${i * 0.2}s` }}>
            <div className="flex justify-between text-xs text-white/75">
              <span className="font-mono">{s}</span>
              <span className="reel-rise text-[#4ade80]" style={{ animationDelay: `${1.6 + i * 0.35}s` }}>
                done
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="reel-line h-full rounded-full bg-gradient-to-r from-[#a5b4fc] to-[#c4b5fd]" style={{ animationDuration: `${1.4 + i * 0.35}s`, animationDelay: `${0.2 + i * 0.2}s` }} />
            </div>
          </div>
        ))}
        <p className="reel-rise text-center text-[11px] text-white/50" style={{ animationDelay: "0.8s" }}>
          The next sites start as soon as one finishes
        </p>
      </div>
    );
  if (k === "rank")
    return (
      <ol className="mx-auto max-w-md space-y-1.5 py-1">
        {[
          ["balloonrides.ae", 92, "#4ade80"],
          ["desertsafari.ae", 81, "#4ade80"],
          ["fixmyroof.com", 64, "#fbbf24"],
          ["citymovers.com", 47, "#fbbf24"],
        ].map(([s, n, c], i) => (
          <li key={s as string} className="reel-slide flex items-center gap-3 rounded-lg bg-white/8 px-3 py-1.5 text-xs ring-1 ring-white/10" style={{ animationDelay: `${0.2 + i * 0.3}s` }}>
            <span className="w-4 font-bold text-white/50">{i + 1}</span>
            <span className="flex-1 font-mono">{s}</span>
            <span className="reel-count font-bold tabular-nums" style={v({ "--to": n as number, "--dur": "1.4s", "--delay": `${0.4 + i * 0.3}s`, color: c as string })} />
          </li>
        ))}
      </ol>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="reel-pop grid h-12 w-12 place-items-center rounded-2xl bg-white text-primary shadow-xl" style={{ animationDelay: `${0.2 + i * 0.25}s` }}>
            <Mail className="h-5 w-5" />
          </span>
        ))}
      </div>
      <p className="reel-rise text-center text-sm text-white/80" style={{ animationDelay: "1.3s" }}>
        <b className="text-white">Send all</b> now — or <b className="text-white">20 a day</b> automatically from your Gmail
      </p>
      <Chip delay={1.7}>WhatsApp stays one click each</Chip>
    </div>
  );
}

export function BulkReel({ className }: { className?: string }) {
  return <Reel scenes={BULK_SCENES} label="Bulk audit — 12-second animation" summary="Paste many websites, they are audited three at a time, ranked by opportunity, and proposals go out together." className={className} render={(k) => <Centered><BulkScene k={k} /></Centered>} />;
}

// ───────────────────────────── New audit ─────────────────────────────

const AUDIT_SCENES: ReelScene[] = [
  { key: "link", label: "Any link", title: "Paste any page — we audit the whole site" },
  { key: "maps", label: "Maps", title: "Or a Google Maps profile" },
  { key: "check", label: "Checks", title: "Dozens of checks, with proof" },
  { key: "after", label: "After", title: "Shows the client their better page" },
];

function AuditScene({ k }: { k: string }) {
  if (k === "link")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="reel-in flex w-full max-w-md items-center gap-2 rounded-2xl bg-white/10 p-2 pl-4 ring-1 ring-white/15">
          <Globe className="h-4 w-4 shrink-0 text-white/55" />
          <span className="reel-type font-mono text-sm">client.ae/pricing</span>
          <span className="reel-caret h-4 w-px bg-white" />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {["Home", "Services", "Pricing", "Contact", "Blog"].map((t, i) => (
            <Chip key={t} delay={1.7 + i * 0.12}>
              {t}
            </Chip>
          ))}
        </div>
      </div>
    );
  if (k === "maps")
    return (
      <div className="grid h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-5">
        <div className="reel-pop grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#f87171] to-[#dc2626] shadow-[0_0_40px_rgb(248_113_113/0.45)]">
          <MapPin className="h-9 w-9" />
        </div>
        <div className="space-y-2">
          <p className="reel-slide text-sm font-semibold" style={{ animationDelay: "0.4s" }}>
            Desert Balloon Rides
          </p>
          <p className="reel-slide flex items-center gap-1 text-xs text-white/75" style={{ animationDelay: "0.6s" }}>
            {[0, 1, 2, 3, 4].map((s) => (
              <Star key={s} className={cn("h-3 w-3", s < 4 ? "fill-[#fbbf24] text-[#fbbf24]" : "text-white/30")} />
            ))}
            4.2 · 31 reviews
          </p>
          <p className="reel-slide text-xs text-white/70" style={{ animationDelay: "0.9s" }}>
            1 · Profile, reviews and Maps position
          </p>
          <p className="reel-slide text-xs text-white/70" style={{ animationDelay: "1.2s" }}>
            2 · Then the website on the profile
          </p>
        </div>
      </div>
    );
  if (k === "check")
    return (
      <div className="grid grid-cols-3 gap-2 py-1 sm:grid-cols-4">
        {["Titles", "Speed", "Mobile", "Schema", "Google profile", "Reviews", "Links", "Call buttons"].map((t, i) => (
          <div key={t} className="reel-tile rounded-lg p-2 text-[11px] ring-1 ring-white/10" style={v({ "--c": i % 3 === 1 ? "#fbbf24" : "#4ade80", animationDelay: `${0.1 + i * 0.15}s` })}>
            <Check className="mb-1 h-3 w-3 text-[#4ade80]" />
            {t}
          </div>
        ))}
      </div>
    );
  return (
    <div className="grid h-full grid-cols-2 items-center gap-4">
      {[false, true].map((after) => (
        <div key={String(after)} className="reel-in overflow-hidden rounded-xl bg-white text-navy shadow-2xl" style={{ animationDelay: after ? "0.6s" : "0s" }}>
          <div className={cn("px-2 py-1 text-[9px] font-bold", after ? "bg-[#16a34a] text-white" : "bg-[#e5e7eb] text-[#475569]")}>{after ? "After our work" : "Today"}</div>
          <div className="space-y-1.5 p-2.5">
            <div className={cn("rounded px-1.5 py-1 text-[9px] font-bold", after && "reel-outline outline outline-2 outline-[#22c55e]")}>{after ? "Balloon Rides in Dubai" : "WELCOME!!"}</div>
            <div className="h-1 w-full rounded bg-[#e2e8f0]" />
            <div className="h-1 w-4/5 rounded bg-[#e2e8f0]" />
            {after && (
              <div className="reel-rise flex gap-1" style={{ animationDelay: "1.4s" }}>
                <span className="rounded-full bg-[#2563eb] px-1.5 py-0.5 text-[8px] font-bold text-white">Call</span>
                <span className="rounded-full bg-[#25D366] px-1.5 py-0.5 text-[8px] font-bold text-white">WhatsApp</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function NewAuditReel({ className }: { className?: string }) {
  return <Reel scenes={AUDIT_SCENES} label="New audit — 12-second animation" summary="Paste any page or a Google Maps link; the whole site is checked and the proposal shows a before-and-after of the homepage." className={className} render={(k) => <Centered><AuditScene k={k} /></Centered>} />;
}

// ───────────────────────────── Prospects ─────────────────────────────

const PROSPECT_SCENES: ReelScene[] = [
  { key: "leads", label: "Leads", title: "Every lead in one place" },
  { key: "today", label: "Today", title: "Know who to contact today" },
  { key: "follow", label: "Follow up", title: "Follow-ups on time, by Gmail or WhatsApp" },
  { key: "won", label: "Won", title: "Won clients, monthly reports" },
];

function ProspectScene({ k }: { k: string }) {
  if (k === "leads")
    return (
      <div className="mx-auto grid max-w-md grid-cols-2 gap-2 py-1">
        {[
          ["Desert Safari", "Audit done"],
          ["Smile Dental", "Proposal sent"],
          ["City Movers", "Meeting"],
          ["Balloon Rides", "New"],
        ].map(([n, s], i) => (
          <div key={n} className="reel-sheet rounded-xl bg-white/10 p-3 ring-1 ring-white/10" style={v({ "--r": "0deg", animationDelay: `${i * 0.2}s` })}>
            <p className="text-sm font-semibold">{n}</p>
            <p className="mt-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/75">{s}</p>
          </div>
        ))}
      </div>
    );
  if (k === "today")
    return (
      <ul className="mx-auto max-w-md space-y-1.5 py-1">
        {[
          ["Replied", "#4ade80", "Smile Dental asked a question"],
          ["Reading now", "#38bdf8", "Desert Safari · 4 min on pricing"],
          ["Follow-up due", "#fbbf24", "City Movers · overdue by 1 day"],
        ].map(([b, c, t], i) => (
          <li key={b} className="reel-slide flex items-center gap-2.5 rounded-xl bg-white/8 px-3 py-2 text-xs ring-1 ring-white/10" style={{ animationDelay: `${0.3 + i * 0.35}s` }}>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${c}26`, color: c }}>
              {b}
            </span>
            <span className="flex-1 text-white/85">{t}</span>
          </li>
        ))}
      </ul>
    );
  if (k === "follow")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-3">
          <span className="reel-pop grid h-12 w-12 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <BellRing className="h-5 w-5 text-[#fbbf24]" />
          </span>
          <span className="reel-line h-0.5 w-10 bg-white/30" style={{ animationDelay: "0.5s" }} />
          <span className="reel-pop grid h-12 w-12 place-items-center rounded-2xl bg-white text-primary" style={{ animationDelay: "0.7s" }}>
            <Mail className="h-5 w-5" />
          </span>
          <span className="reel-pop grid h-12 w-12 place-items-center rounded-2xl bg-[#25D366]" style={{ animationDelay: "0.9s" }}>
            <WhatsAppIcon className="h-5 w-5" />
          </span>
        </div>
        <div className="flex gap-2">
          <Chip delay={1.3}>Day 3 reminder</Chip>
          <Chip delay={1.5}>Day 7 reminder</Chip>
          <Chip delay={1.7}>Seen → follow-up ready</Chip>
        </div>
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <span className="reel-pop grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[#fbbf24] to-[#f97316] shadow-[0_0_40px_rgb(251_191_36/0.45)]">
        <Trophy className="h-8 w-8" />
      </span>
      <p className="reel-rise text-lg font-bold" style={{ animationDelay: "0.5s" }}>
        <CountUp to={4} delayMs={600} durationMs={900} /> clients won this month
      </p>
      <div className="flex gap-2">
        <Chip delay={1.0}>
          <Layers className="mr-1 inline h-3 w-3" />
          Monthly tasks
        </Chip>
        <Chip delay={1.2}>
          <FileText className="mr-1 inline h-3 w-3" />
          Before vs now report
        </Chip>
        <Chip delay={1.4}>
          <Send className="mr-1 inline h-3 w-3" />
          Re-audited monthly
        </Chip>
      </div>
    </div>
  );
}

export function ProspectsReel({ className }: { className?: string }) {
  return <Reel scenes={PROSPECT_SCENES} label="Prospects — 12-second animation" summary="All leads in one place, who to contact today, follow-ups by Gmail or WhatsApp, and monthly reports for won clients." className={className} render={(k) => <Centered><ProspectScene k={k} /></Centered>} />;
}
