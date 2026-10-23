"use client";

import { Check, Palette as PaletteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES } from "@/lib/proposals/types";
import { BRAND_THEME, isHexColor, paletteFromColor, type Palette } from "@/lib/proposals/theme";

/** A tiny proposal cover in the theme's colours. */
function Thumb({ palette, logo, label }: { palette: Palette; logo?: string | null; label: string }) {
  return (
    <div className="relative h-20 overflow-hidden rounded-lg" style={{ background: palette.dark }} aria-hidden>
      <div className="absolute -top-6 -right-6 h-16 w-16 rounded-full opacity-60" style={{ background: palette.primary }} />
      <div className="absolute top-2 left-2.5 flex items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI from private storage */}
        {logo ? <img src={logo} alt="" className="h-3.5 max-w-8 rounded-sm bg-white object-contain p-px" /> : <span className="h-2.5 w-2.5 rounded-sm bg-white/80" />}
        <span className="h-1 w-8 rounded-full bg-white/50" />
      </div>
      <div className="absolute bottom-6 left-2.5 h-1.5 w-16 rounded-full bg-white/90" />
      <div className="absolute bottom-3.5 left-2.5 h-1 w-10 rounded-full bg-white/50" />
      <div className="absolute right-0 bottom-0 left-0 h-1.5" style={{ background: palette.soft }} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ThemePicker({
  value,
  onChange,
  brandColor,
  onBrandColorChange,
  logo,
  disabled,
}: {
  value: string;
  onChange: (theme: string) => void;
  brandColor: string | null;
  /** When omitted, the brand colour is shown read-only (it is set in Settings). */
  onBrandColorChange?: (color: string) => void;
  logo?: string | null;
  disabled?: boolean;
}) {
  const brandOk = isHexColor(brandColor);
  const options = [
    ...Object.entries(THEMES).map(([key, t]) => ({ key, label: t.label, palette: t as Palette })),
    { key: BRAND_THEME, label: "My brand colour", palette: brandOk ? paletteFromColor(brandColor!) : null },
  ];
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Proposal theme" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {options.map((o) => {
          const selected = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || (!o.palette && !onBrandColorChange)}
              onClick={() => onChange(o.key)}
              className={cn(
                "group relative rounded-xl border bg-surface p-1.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none",
                selected ? "border-primary ring-4 ring-primary/15" : "border-border hover:border-primary/40",
              )}
            >
              {o.palette ? (
                <Thumb palette={o.palette} logo={logo} label={o.label} />
              ) : (
                <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-muted">
                  <PaletteIcon className="h-5 w-5" />
                </div>
              )}
              <span className="mt-1.5 flex items-center justify-between gap-1 px-1 pb-0.5 text-xs font-medium">
                {o.label}
                {selected && (
                  <span className="rounded-full bg-primary p-0.5 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {onBrandColorChange ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/60 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="color"
              value={brandOk ? brandColor! : "#4f46e5"}
              onChange={(e) => {
                onBrandColorChange(e.target.value);
                onChange(BRAND_THEME);
              }}
              disabled={disabled}
              className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-surface p-1"
              aria-label="Brand colour"
            />
            Your brand colour
          </label>
          <input
            type="text"
            value={brandColor ?? ""}
            onChange={(e) => onBrandColorChange(e.target.value.trim())}
            placeholder="#4f46e5"
            maxLength={7}
            disabled={disabled}
            aria-label="Brand colour hex code"
            className="h-9 w-28 rounded-lg border border-border bg-surface px-2.5 font-mono text-sm uppercase focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none"
          />
          <p className="text-xs text-muted">Pick your logo&apos;s main colour. Very light colours are darkened automatically so text stays readable.</p>
        </div>
      ) : (
        !brandOk && <p className="text-xs text-muted">To use your own colour, set a brand colour in Settings.</p>
      )}
    </div>
  );
}
