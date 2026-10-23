"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, Check, Rocket, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChecklistStep } from "@/lib/onboarding";

const KEY = "gettingStartedHidden";
const CHANGE = "getting-started-change";

function readHidden() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

/** Dashboard checklist. Hidden automatically when every required step is done, or by the user. */
export function GettingStarted({ steps }: { steps: ChecklistStep[] }) {
  // Hidden on the server; the browser then applies the saved choice.
  const hidden = useSyncExternalStore(subscribe, readHidden, () => true);
  const required = steps.filter((s) => !s.optional);
  const doneCount = steps.filter((s) => s.done).length;
  if (hidden || required.every((s) => s.done)) return null;
  const next = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done);
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <section aria-label="Getting started" className="animate-rise relative mb-6 overflow-hidden rounded-2xl border border-primary/20 bg-surface shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_20rem_at_0%_0%,var(--primary-soft),transparent_60%)]" />
      <div className="relative p-5 sm:p-6">
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(KEY, "1");
            } catch {}
            window.dispatchEvent(new Event(CHANGE));
          }}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Hide getting started"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex flex-wrap items-center gap-4 pr-8">
          <span className="rounded-xl bg-gradient-to-br from-primary to-accent p-2.5 text-white shadow-md">
            <Rocket className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Get set up in a few minutes</h2>
            <p className="text-sm text-muted">
              {doneCount} of {steps.length} done — from a website address to a sent proposal.
            </p>
          </div>
          {next && (
            <Link href={next.href} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-md">
              Next: {next.title.toLowerCase()} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className={cn(
                  "group flex h-full gap-3 rounded-xl border p-3.5 transition-all",
                  s.done ? "border-success/25 bg-success-soft/40" : "border-border bg-surface hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    s.done ? "bg-success text-white" : "bg-primary-soft text-primary",
                  )}
                >
                  {s.done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium", s.done && "text-muted line-through decoration-muted/50")}>
                    {s.title}
                    {s.optional && <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{s.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
