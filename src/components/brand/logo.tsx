import { cn } from "@/lib/utils";

export const PRODUCT_NAME = "LeadLift";
export const PRODUCT_TAGLINE = "Audit · Propose · Win";

/** The LeadLift mark: an "L" whose corner lifts into a rising arrow, on the brand gradient. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  // Fixed ids: every copy of the mark defines the same gradients, so sharing them is harmless.
  const id = "leadlift";
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="0.55" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.2" cy="0.1" r="0.9">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-bg)`} />
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-glow)`} />
      <path d="M20 14v27a5 5 0 0 0 5 5h21" fill="none" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29 37 45 21" fill="none" stroke="#67e8f9" strokeWidth="6" strokeLinecap="round" />
      <path d="M35 19.5h11.5V31" fill="none" stroke="#67e8f9" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark plus the "LeadLift" wordmark; `tagline` adds the small line underneath. */
export function Logo({ className, tagline = false, inverted = false }: { className?: string; tagline?: boolean; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="h-9 w-9 shrink-0 drop-shadow-[0_6px_16px_rgb(79_70_229/0.45)]" />
      <span className="min-w-0 leading-tight">
        <span className={cn("block text-[17px] font-bold tracking-[-0.02em]", inverted ? "text-white" : "text-text")}>
          Lead<span className="bg-gradient-to-r from-[#22d3ee] to-[#a78bfa] bg-clip-text text-transparent">Lift</span>
        </span>
        {tagline && <span className={cn("block text-[11px]", inverted ? "text-white/55" : "text-muted")}>{PRODUCT_TAGLINE}</span>}
      </span>
    </span>
  );
}
