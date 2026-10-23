"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Label, Select, Textarea, buttonClass, tabBarClass, tabClass } from "@/components/ui";
import { ROADMAPS, SERVICES, type Deliverable, type ProposalFinding, type ProposalKeyword, type RoadmapKey, type RoadmapPhase, type ServiceKey } from "@/lib/proposals/types";
import { cn } from "@/lib/utils";
import { ThemePicker } from "@/components/theme-picker";
import { keywordsFromResearchAction, roadmapForPresetAction, saveProposalAction } from "../../actions";

type SectionState = { key: string; title: string; body: string; included: boolean; data: { findings?: ProposalFinding[]; phases?: RoadmapPhase[]; keywords?: ProposalKeyword[] } | null };

export type EditorState = {
  title: string;
  proposalDate: string;
  validUntil: string;
  currency: string;
  monthlyPrice: string;
  setupFee: string;
  durationMonths: string;
  paymentTerms: string;
  roadmap: RoadmapKey;
  theme: string;
  services: ServiceKey[];
  deliverables: Deliverable[];
  clientNotes: string;
  includeAppendix: boolean;
  sections: SectionState[];
};

const TABS = ["Details", "Services & deliverables", "Sections"] as const;

function newFinding(): ProposalFinding {
  return {
    id: crypto.randomUUID(),
    sourceFindingId: null,
    title: "New finding",
    severity: "MEDIUM",
    observed: "",
    where: [],
    evidence: "",
    whyItMatters: "",
    solution: "",
    priority: "Medium",
    period: "Days 31–60",
    verification: "",
    custom: true,
  };
}

function FindingsEditor({ findings, onChange }: { findings: ProposalFinding[]; onChange: (f: ProposalFinding[]) => void }) {
  const update = (i: number, patch: Partial<ProposalFinding>) => onChange(findings.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-3">
      {findings.map((f, i) => (
        <details key={f.id} className="rounded-lg border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
            <Badge tone={f.priority === "High" ? "danger" : f.priority === "Medium" ? "warning" : "neutral"}>{f.priority}</Badge>
            {f.custom && <Badge tone="primary">custom</Badge>}
            <span className="flex-1 truncate font-medium">{f.title}</span>
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={(e) => (e.preventDefault(), onChange(move(findings, i, -1)))} className="p-1 text-muted hover:text-text disabled:opacity-30">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Move down" disabled={i === findings.length - 1} onClick={(e) => (e.preventDefault(), onChange(move(findings, i, 1)))} className="p-1 text-muted hover:text-text disabled:opacity-30">
              <ArrowDown className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Remove finding" onClick={(e) => (e.preventDefault(), confirm(`Remove “${f.title}” from this proposal?`) && onChange(findings.filter((_, j) => j !== i)))} className="p-1 text-danger">
              <Trash2 className="h-4 w-4" />
            </button>
          </summary>
          <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
            <Field label="Title" name={`f-${f.id}-title`} className="sm:col-span-2">
              <Input value={f.title} onChange={(e) => update(i, { title: e.target.value })} />
            </Field>
            <Field label="What was observed" name={`f-${f.id}-obs`} className="sm:col-span-2" hint={f.custom ? "Describe only what you actually observed." : "From the audit evidence. Edit wording, not facts."}>
              <Textarea rows={3} value={f.observed} onChange={(e) => update(i, { observed: e.target.value })} />
            </Field>
            <Field label="Where (one URL per line)" name={`f-${f.id}-where`} className="sm:col-span-2">
              <Textarea rows={2} value={f.where.join("\n")} onChange={(e) => update(i, { where: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10) })} />
            </Field>
            <Field label="Why it matters" name={`f-${f.id}-why`}>
              <Textarea rows={3} value={f.whyItMatters} onChange={(e) => update(i, { whyItMatters: e.target.value })} />
            </Field>
            <Field label="Recommended solution" name={`f-${f.id}-sol`}>
              <Textarea rows={3} value={f.solution} onChange={(e) => update(i, { solution: e.target.value })} />
            </Field>
            <Field label="Priority" name={`f-${f.id}-prio`}>
              <Select value={f.priority} onChange={(e) => update(i, { priority: e.target.value as ProposalFinding["priority"] })}>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </Select>
            </Field>
            <Field label="Implementation period" name={`f-${f.id}-period`}>
              <Input value={f.period} onChange={(e) => update(i, { period: e.target.value })} />
            </Field>
            <Field label="How the result will be checked" name={`f-${f.id}-ver`} className="sm:col-span-2">
              <Input value={f.verification} onChange={(e) => update(i, { verification: e.target.value })} />
            </Field>
          </div>
        </details>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...findings, newFinding()])}>
        <Plus className="h-4 w-4" /> Add custom finding
      </Button>
    </div>
  );
}

function PhasesEditor({ phases, onChange }: { phases: RoadmapPhase[]; onChange: (p: RoadmapPhase[]) => void }) {
  const update = (i: number, patch: Partial<RoadmapPhase>) => onChange(phases.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-3">
      {phases.map((p, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[10rem_1fr_auto]">
          <Input aria-label="Period" value={p.period} onChange={(e) => update(i, { period: e.target.value })} />
          <Input aria-label="Phase title" value={p.title} onChange={(e) => update(i, { title: e.target.value })} />
          <Button size="icon" variant="ghost" aria-label="Remove phase" onClick={() => onChange(phases.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
          <Textarea aria-label="Phase items, one per line" className="sm:col-span-3" rows={Math.min(8, p.items.length + 1)} value={p.items.join("\n")} onChange={(e) => update(i, { items: e.target.value.split("\n").filter((x) => x.trim()) })} />
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...phases, { title: "New phase", period: "Months 4–6", items: ["Planned work"] }])}>
        <Plus className="h-4 w-4" /> Add phase
      </Button>
    </div>
  );
}

function KeywordsEditor({ keywords, onChange, onReload, pending, researchHref }: { keywords: ProposalKeyword[]; onChange: (k: ProposalKeyword[]) => void; onReload: () => void; pending: boolean; researchHref: string }) {
  return (
    <div className="space-y-2">
      {keywords.length === 0 ? (
        <p className="text-sm text-muted">No target keywords in this proposal. Choose keywords on the Research tab, then reload them here.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {keywords.map((k, i) => (
            <li key={`${k.keyword}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{k.keyword}</span>
                <span className="ml-2 text-xs text-muted">
                  {k.volume != null ? `${k.volume.toLocaleString("en-US")}${k.volumeIsEstimate ? " est." : ""}/mo` : "volume to be measured"}
                </span>
              </span>
              <button type="button" aria-label={`Move up: ${k.keyword}`} disabled={i === 0} onClick={() => onChange(move(keywords, i, -1))} className="p-1 text-muted hover:text-text disabled:opacity-30">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`Move down: ${k.keyword}`} disabled={i === keywords.length - 1} onClick={() => onChange(move(keywords, i, 1))} className="p-1 text-muted hover:text-text disabled:opacity-30">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`Remove keyword: ${k.keyword}`} onClick={() => onChange(keywords.filter((_, j) => j !== i))} className="p-1 text-danger">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={onReload}>
          <RefreshCw className="h-4 w-4" /> Reload from Research
        </Button>
        <Link href={researchHref} className="text-xs text-primary hover:underline">
          Choose keywords on the Research tab →
        </Link>
      </div>
    </div>
  );
}

function move<T>(arr: T[], i: number, dir: -1 | 1) {
  const next = [...arr];
  const j = i + dir;
  if (j < 0 || j >= next.length) return arr;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function ProposalEditor({
  proposalId,
  baseVersion,
  latestVersion,
  locked,
  clientName,
  initial,
  brand,
  researchHref,
}: {
  proposalId: string;
  baseVersion: number;
  latestVersion: number;
  locked: boolean;
  clientName: string;
  initial: EditorState;
  /** Current workspace branding, used for the theme previews. */
  brand: { color: string | null; logo: string | null };
  researchHref: string;
}) {
  const router = useRouter();
  const [s, setS] = useState<EditorState>(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Details");
  const [changeNote, setChangeNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<EditorState>) => {
    setS((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };
  const setSection = (i: number, patch: Partial<SectionState>) => set({ sections: s.sections.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const mustCreateNew = locked || baseVersion !== latestVersion;

  function save(asNew: boolean) {
    start(async () => {
      const payload = {
        ...s,
        validUntil: s.validUntil || null,
        monthlyPrice: s.monthlyPrice === "" ? null : s.monthlyPrice,
        setupFee: s.setupFee === "" ? null : s.setupFee,
        paymentTerms: s.paymentTerms || null,
        clientNotes: s.clientNotes || null,
        changeNote: changeNote || undefined,
      };
      const r = await saveProposalAction(proposalId, baseVersion, payload, asNew || mustCreateNew);
      if (!r.ok) return void toast.error(r.error);
      setDirty(false);
      toast.success(r.createdNew ? `Saved as version ${r.version}${r.lockedBase ? ` — v${baseVersion} stays exactly as sent` : ""}` : "Draft saved");
      router.push(`/proposals/${proposalId}${r.createdNew ? "" : `?v=${r.version}`}`);
      router.refresh();
    });
  }

  function reloadKeywords() {
    start(async () => {
      const r = await keywordsFromResearchAction(proposalId);
      if (!r.ok) return void toast.error(r.error);
      // The intro text is replaced only while it is still the untouched "plan" text; edited text is kept.
      const replaceBody = (body: string) => (r.body && (!body.trim() || body.startsWith(r.planIntro)) ? r.body : body);
      set({ sections: s.sections.map((x) => (x.key === "keywords" ? { ...x, body: replaceBody(x.body), included: x.included || r.keywords.length > 0, data: { ...(x.data ?? {}), keywords: r.keywords } } : x)) });
      toast.success(r.keywords.length ? `${r.keywords.length} keywords loaded${r.chosen ? "" : " (top by priority — none were chosen)"}` : "No keywords in Research yet");
    });
  }

  function applyRoadmapPreset(roadmap: RoadmapKey) {
    start(async () => {
      const r = await roadmapForPresetAction(proposalId, roadmap, s.services);
      if (!r.ok) return void toast.error(r.error);
      const months = roadmap === "12_MONTH" ? 12 : roadmap === "6_MONTH" ? 6 : Number(s.durationMonths);
      set({
        roadmap,
        durationMonths: String(Math.max(months, roadmap === "90_DAY" ? 3 : months)),
        sections: s.sections.map((x) => (x.key === "roadmap" ? { ...x, data: { ...(x.data ?? {}), phases: r.phases } } : x)),
      });
      toast.success("Roadmap updated from the audit findings");
    });
  }

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit proposal</h1>
          <p className="mt-1 text-sm text-muted">
            {clientName} · editing from v{baseVersion}
          </p>
        </div>
        <Link href={`/proposals/${proposalId}?v=${baseVersion}`} className={buttonClass("ghost")}>
          Cancel
        </Link>
      </div>

      {mustCreateNew && (
        <Alert tone="info" title={locked ? `Version ${baseVersion} has been sent` : `You are editing an older version`} className="mb-4">
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3.5 w-3.5" /> Saving will create version {latestVersion + 1}. Version {baseVersion} will not change.
          </span>
        </Alert>
      )}

      <div className={`${tabBarClass} mb-4`} role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={tabClass(tab === t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Details" && (
        <div className="max-w-3xl">
          <Card>
            <CardHeader title="Document" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Proposal title" name="title" className="sm:col-span-2">
                <Input value={s.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="Proposal date" name="proposalDate">
                <Input type="date" value={s.proposalDate} onChange={(e) => set({ proposalDate: e.target.value })} />
              </Field>
              <Field label="Valid until" name="validUntil">
                <Input type="date" value={s.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Label>Theme</Label>
                <ThemePicker value={s.theme} onChange={(theme) => set({ theme })} brandColor={brand.color} logo={brand.logo} />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={s.includeAppendix} onChange={(e) => set({ includeAppendix: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
                  Include full audit appendix
                </label>
              </div>
              <Field label="Client-specific note (shown at the top)" name="clientNotes" className="sm:col-span-2">
                <Textarea rows={3} value={s.clientNotes} onChange={(e) => set({ clientNotes: e.target.value })} placeholder="Optional personal note to the client" />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {tab === "Services & deliverables" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Included services" description="Service sections without a tick are hidden from the proposal." />
            <div className="grid gap-2 p-5 sm:grid-cols-2">
              {(Object.keys(SERVICES) as ServiceKey[]).map((k) => (
                <label key={k} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--primary)]"
                    checked={s.services.includes(k)}
                    onChange={(e) => set({ services: e.target.checked ? [...s.services, k] : s.services.filter((x) => x !== k) })}
                  />
                  {SERVICES[k]}
                </label>
              ))}
            </div>
            <div className="border-t border-border p-5">
              <Label htmlFor="roadmap">Roadmap length</Label>
              <div className="mt-1.5 flex gap-2">
                <Select id="roadmap" value={s.roadmap} onChange={(e) => set({ roadmap: e.target.value as RoadmapKey })}>
                  {Object.entries(ROADMAPS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" disabled={pending} onClick={() => applyRoadmapPreset(s.roadmap)}>
                  <RefreshCw className="h-4 w-4" /> Rebuild roadmap
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted">Rebuilds the roadmap phases from the audit findings and selected services. Manual edits to phases are replaced.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Monthly deliverables" />
            <div className="space-y-2 p-5">
              {s.deliverables.map((d, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                  <Input aria-label="Deliverable" value={d.title} onChange={(e) => set({ deliverables: s.deliverables.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <Input aria-label="Details" value={d.detail} onChange={(e) => set({ deliverables: s.deliverables.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })} />
                  <Button size="icon" variant="ghost" aria-label="Remove deliverable" onClick={() => set({ deliverables: s.deliverables.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set({ deliverables: [...s.deliverables, { title: "", detail: "" }] })}>
                <Plus className="h-4 w-4" /> Add deliverable
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === "Sections" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Edit wording, hide sections that do not apply, and reorder with the arrows. Use a blank line for a new paragraph and “- ” for bullet points.</p>
          {s.sections.map((sec, i) => (
            <Card key={sec.key + i} className={cn(!sec.included && "opacity-60")}>
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <span className="w-6 text-xs tabular-nums text-muted">{String(i + 1).padStart(2, "0")}</span>
                <Input aria-label="Section title" value={sec.title} onChange={(e) => setSection(i, { title: e.target.value })} className="h-8 flex-1 border-transparent font-medium hover:border-border" />
                <Button size="icon" variant="ghost" aria-label={`${sec.included ? "Hide" : "Show"} section: ${sec.title}`} title={sec.included ? "Hide section" : "Show section"} onClick={() => setSection(i, { included: !sec.included })}>
                  {sec.included ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Move section up: ${sec.title}`} disabled={i === 0} onClick={() => set({ sections: move(s.sections, i, -1) })}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Move section down: ${sec.title}`} disabled={i === s.sections.length - 1} onClick={() => set({ sections: move(s.sections, i, 1) })}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
              {sec.included && (
                <div className="space-y-3 p-4">
                  {sec.key === "deliverables" ? <p className="text-sm text-muted">The deliverables table comes from the “Services & deliverables” tab.</p> : null}
                  <Textarea aria-label={`${sec.title} text`} rows={Math.min(14, Math.max(3, sec.body.split("\n").length + 1))} value={sec.body} onChange={(e) => setSection(i, { body: e.target.value })} />
                  {(sec.key === "key_findings" || sec.key === "appendix") && (
                    <FindingsEditor findings={sec.data?.findings ?? []} onChange={(findings) => setSection(i, { data: { ...(sec.data ?? {}), findings } })} />
                  )}
                  {sec.key === "keywords" && (
                    <KeywordsEditor
                      keywords={sec.data?.keywords ?? []}
                      onChange={(keywords) => setSection(i, { data: { ...(sec.data ?? {}), keywords } })}
                      onReload={reloadKeywords}
                      pending={pending}
                      researchHref={researchHref}
                    />
                  )}
                  {sec.key === "roadmap" && <PhasesEditor phases={sec.data?.phases ?? []} onChange={(phases) => setSection(i, { data: { ...(sec.data ?? {}), phases } })} />}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur lg:pl-64">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          <span className="mr-auto text-sm text-muted">{dirty ? "Unsaved changes" : "No changes yet"}</span>
          <Input aria-label="Change note (optional)" placeholder="Change note (optional)" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} className="h-9 w-full sm:w-64" />
          {!mustCreateNew && (
            <Button variant="secondary" disabled={pending} onClick={() => save(false)}>
              <Save className="h-4 w-4" /> Save draft
            </Button>
          )}
          <Button disabled={pending} onClick={() => save(true)}>
            <Plus className="h-4 w-4" /> Save as version {latestVersion + 1}
          </Button>
        </div>
      </div>
    </div>
  );
}
