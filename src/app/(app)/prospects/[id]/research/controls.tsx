"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, FileText, Gauge, Globe, Loader2, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { IMPORT_KINDS, IMPORT_SOURCES } from "@/lib/research/csv";
import type { ResearchResult } from "./actions";
import {
  addCompetitorAction,
  addKeywordsAction,
  aiKeywordIdeasAction,
  analyseAction,
  chooseTopKeywordsAction,
  toggleKeywordInProposalAction,
  deleteCompetitorAction,
  deleteImportAction,
  domainCheckAction,
  generateSeedsAction,
  observeCompetitorAction,
  pageSpeedAction,
} from "./actions";

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (fn: () => Promise<ResearchResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        after?.();
        router.refresh();
      } else toast.error(r.error);
    });
  return { pending, go };
}

export function KeywordActions({ prospectId, aiReady }: { prospectId: string; aiReady: boolean }) {
  const { pending, go } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        disabled={pending || !aiReady}
        title={aiReady ? undefined : "Add a free Gemini API key on the Integrations page"}
        onClick={() => go(() => aiKeywordIdeasAction(prospectId))}
      >
        <Bot className="h-4 w-4" /> {pending ? "Thinking…" : "AI keyword ideas (Gemini)"}
      </Button>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => go(() => generateSeedsAction(prospectId))}>
        <Sparkles className="h-4 w-4" /> Generate ideas from services
      </Button>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => go(() => analyseAction(prospectId))}>
        <Wand2 className="h-4 w-4" /> Re-cluster &amp; map to pages
      </Button>
      {pending && <Loader2 className="h-4 w-4 animate-spin self-center text-muted" />}
    </div>
  );
}

/** Checkbox on a keyword row: include it in the proposal's keyword section. */
export function ProposalKeywordToggle({ prospectId, keywordId, keyword, checked }: { prospectId: string; keywordId: string; keyword: string; checked: boolean }) {
  const { pending, go } = useAction();
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={pending}
      onChange={(e) => go(() => toggleKeywordInProposalAction(prospectId, keywordId, e.target.checked))}
      aria-label={`Use “${keyword}” in the proposal`}
      className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
    />
  );
}

export function ProposalKeywordBar({ prospectId, chosen, total }: { prospectId: string; chosen: number; total: number }) {
  const { pending, go } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary-soft/40 px-4 py-3 text-sm">
      <span className="flex items-center gap-1.5 font-medium">
        <FileText className="h-4 w-4 text-primary" />
        {chosen ? `${chosen} keyword${chosen === 1 ? "" : "s"} chosen for the proposal` : "No keywords chosen for the proposal yet"}
      </span>
      <span className="text-xs text-muted">{chosen ? "New proposals show them as a table of target searches." : "Tick keywords below, or let us pick the top ones. If none are chosen, proposals use the top 8 by priority."}</span>
      <span className="ml-auto flex gap-2">
        <Button size="sm" variant="secondary" disabled={pending || total === 0} onClick={() => go(() => chooseTopKeywordsAction(prospectId, 10))}>
          Choose top 10
        </Button>
        {chosen > 0 && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(() => chooseTopKeywordsAction(prospectId, 0))}>
            Clear
          </Button>
        )}
      </span>
    </div>
  );
}

export function AddKeywordsForm({ prospectId }: { prospectId: string }) {
  const { pending, go } = useAction();
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <Textarea aria-label="Keywords to add" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="One keyword per line" />
      <Button size="sm" variant="secondary" disabled={pending || !text.trim()} onClick={() => go(() => addKeywordsAction(prospectId, text), () => setText(""))}>
        Add keywords
      </Button>
    </div>
  );
}

export function ImportForm({ prospectId }: { prospectId: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/imports`, { method: "POST", body: new FormData(e.currentTarget) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Import failed");
      toast.success(`Imported ${body.rows} rows from ${IMPORT_SOURCES[body.source as keyof typeof IMPORT_SOURCES]}${body.skipped ? ` (${body.skipped} skipped)` : ""}`);
      formRef.current?.reset();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="CSV export" name="file" className="sm:col-span-2" hint="Ahrefs, Semrush or Search Console export (CSV/TSV, UTF-8 or UTF-16), up to 8 MB">
        <Input type="file" accept=".csv,.tsv,.txt,text/csv" required className="h-auto py-1.5 text-xs" />
      </Field>
      <Field label="Data type" name="kind">
        <Select defaultValue="">
          <option value="">Detect automatically</option>
          {Object.entries(IMPORT_KINDS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Source tool" name="source">
        <Select defaultValue="">
          <option value="">Detect automatically</option>
          {Object.entries(IMPORT_SOURCES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Date range (Search Console)" name="periodLabel" className="sm:col-span-2">
        <Input placeholder="e.g. Last 3 months" />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {pending ? "Importing…" : "Import"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteImportButton({ prospectId, importId, label }: { prospectId: string; importId: string; label: string }) {
  const { pending, go } = useAction();
  return (
    <Button size="icon" variant="ghost" aria-label={`Remove import ${label}`} disabled={pending} onClick={() => confirm(`Remove “${label}” and the data it added?`) && go(() => deleteImportAction(prospectId, importId))}>
      <Trash2 className="h-4 w-4 text-danger" />
    </Button>
  );
}

export function AddCompetitorForm({ prospectId }: { prospectId: string }) {
  const { pending, go } = useAction();
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Competitor website" name="competitorDomain">
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="competitor.com" />
      </Field>
      <Field label="Business name (optional)" name="competitorName">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button disabled={pending || !domain.trim()} onClick={() => go(() => addCompetitorAction(prospectId, domain, name), () => (setDomain(""), setName("")))}>
        Add competitor
      </Button>
    </div>
  );
}

export function CompetitorButtons({ prospectId, competitorId, domain }: { prospectId: string; competitorId: string; domain: string }) {
  const { pending, go } = useAction();
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => go(() => observeCompetitorAction(prospectId, competitorId))}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {pending ? "Observing…" : "Observe site"}
      </Button>
      <Button size="icon" variant="ghost" aria-label={`Remove ${domain}`} disabled={pending} onClick={() => confirm(`Remove ${domain}?`) && go(() => deleteCompetitorAction(prospectId, competitorId))}>
        <Trash2 className="h-4 w-4 text-danger" />
      </Button>
    </div>
  );
}

export function PageSpeedButtons({ prospectId }: { prospectId: string }) {
  const { pending, go } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={pending} onClick={() => go(() => pageSpeedAction(prospectId, "MOBILE"))}>
        <Gauge className="h-4 w-4" /> Test mobile
      </Button>
      <Button variant="secondary" disabled={pending} onClick={() => go(() => pageSpeedAction(prospectId, "DESKTOP"))}>
        Test desktop
      </Button>
      {pending && (
        <span className="flex items-center gap-1 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Google is testing the page (up to a minute)…
        </span>
      )}
    </div>
  );
}

export function DomainCheckButton({ prospectId, competitorId, label = "Check" }: { prospectId: string; competitorId: string | null; label?: string }) {
  const { pending, go } = useAction();
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => go(() => domainCheckAction(prospectId, competitorId))}>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />} {pending ? "Checking…" : label}
    </Button>
  );
}
