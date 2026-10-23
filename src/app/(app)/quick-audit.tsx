"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, Globe, Layers, Loader2, Sparkles } from "lucide-react";
import { startAuditAction } from "./audits/actions";

/** Dashboard hero: one field, one click — audit plus an automatically drafted proposal. */
export function QuickAudit() {
  const [state, action, pending] = useActionState(startAuditAction, undefined);
  const error = state?.fieldErrors?.websiteUrl?.[0] ?? state?.error;

  return (
    <section aria-label="Quick audit" className="relative flex flex-col justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-navy via-navy-2 to-[#2a1f6e] p-6 text-white shadow-lift sm:p-8">
      <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-primary/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-accent/30 blur-3xl" />
      <div className="relative">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/15">
          <Sparkles className="h-3.5 w-3.5 text-[#c4b5fd]" /> Audit + proposal in about two minutes
        </p>
        <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">Which website should we look at?</h2>
        <p className="mt-1 max-w-xl text-sm text-white/65">
          Paste the address. We audit the site, check its domain, and draft a proposal you can send. Nothing goes out until you approve it.
        </p>
        <form action={action} className="mt-5 flex flex-col gap-2 sm:flex-row" noValidate>
          <input type="hidden" name="autoProposal" value="on" />
          <label className="relative flex-1">
            <span className="sr-only">Website URL</span>
            <Globe className="pointer-events-none absolute top-1/2 left-4 z-10 h-5 w-5 -translate-y-1/2 text-white/55" />
            <input
              name="websiteUrl"
              inputMode="url"
              autoComplete="url"
              placeholder="e.g. clientwebsite.com"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "quick-audit-error" : undefined}
              className="h-13 w-full rounded-2xl border border-white/15 bg-white/10 pr-4 pl-12 text-base text-white backdrop-blur transition placeholder:text-white/40 focus:border-white/40 focus:bg-white/15 focus:ring-4 focus:ring-white/10 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-13 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-sm font-semibold text-navy shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.98] disabled:opacity-70"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {pending ? "Checking…" : "Audit & prepare proposal"}
          </button>
        </form>
        {error && (
          <p id="quick-audit-error" role="alert" className="mt-2 text-sm text-[#fecaca]">
            {error}
          </p>
        )}
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/55">
          <Link href="/audits/new" className="hover:text-white">
            More options (city, services, contact) →
          </Link>
          <Link href="/audits/bulk" className="inline-flex items-center gap-1 hover:text-white">
            <Layers className="h-3 w-3" /> Audit many websites at once →
          </Link>
        </p>
      </div>
    </section>
  );
}
