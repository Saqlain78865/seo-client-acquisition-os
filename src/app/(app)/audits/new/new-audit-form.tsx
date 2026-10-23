"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ScanSearch, Sparkles } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { CURRENCIES } from "@/lib/constants";
import { startAuditAction } from "../actions";

type Prospect = { id: string; businessName: string; websiteUrl: string; country: string | null; city: string | null; primaryServices: string | null } | null;

export function NewAuditForm({ prospect, defaultCurrency }: { prospect: Prospect; defaultCurrency: string }) {
  const [state, action, pending] = useActionState(startAuditAction, undefined);
  const [more, setMore] = useState(false);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-6" noValidate>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {prospect && (
        <Alert tone="info" title={`Auditing for ${prospect.businessName}`}>
          The audit will be saved to this prospect&apos;s history.
        </Alert>
      )}
      {prospect && <input type="hidden" name="prospectId" value={prospect.id} />}

      <Field label="Website URL" name="websiteUrl" error={e?.websiteUrl} required hint="Only public http(s) websites. Login areas and blocked pages are never accessed.">
        <Input defaultValue={prospect?.websiteUrl} placeholder="example.com" inputMode="url" autoFocus={!prospect} className="h-11 text-base" />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary/25 bg-primary-soft/50 p-4 transition-colors hover:border-primary/50">
        <input type="checkbox" name="autoProposal" defaultChecked className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <Sparkles className="h-4 w-4 text-primary" /> Prepare the proposal automatically
          </span>
          <span className="mt-0.5 block text-xs text-muted">When the audit finishes, a ready-to-send proposal is drafted from its findings. You review it before anything is sent.</span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        {!prospect && (
          <Field label="Client / business name" name="clientName" error={e?.clientName} hint="Leave empty to infer it from the website (marked unverified).">
            <Input />
          </Field>
        )}
        <Field label="Primary service" name="primaryService" error={e?.primaryService}>
          <Input defaultValue={prospect?.primaryServices?.split(",")[0]?.trim()} placeholder="e.g. Dental implants" />
        </Field>
        <Field label="Target country" name="targetCountry" error={e?.targetCountry}>
          <Input defaultValue={prospect?.country ?? undefined} />
        </Field>
        <Field label="Target city or region" name="targetCity" error={e?.targetCity} hint="Used to check local relevance on the site.">
          <Input defaultValue={prospect?.city ?? undefined} />
        </Field>
      </div>

      <button type="button" onClick={() => setMore((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-primary" aria-expanded={more}>
        <ChevronDown className={`h-4 w-4 transition-transform ${more ? "rotate-180" : ""}`} /> More details (optional)
      </button>

      <div className={more ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <Field label="Secondary services" name="secondaryServices" error={e?.secondaryServices}>
          <Input />
        </Field>
        <Field label="Business type" name="businessType" error={e?.businessType}>
          <Input placeholder="e.g. Local clinic, e-commerce" />
        </Field>
        <Field label="Preferred language" name="preferredLanguage" error={e?.preferredLanguage}>
          <Input placeholder="e.g. English" />
        </Field>
        <Field label="Desired SEO package" name="servicePackage" error={e?.servicePackage}>
          <Input placeholder="e.g. Local SEO monthly" />
        </Field>
        <Field label="Proposal currency" name="currency" error={e?.currency}>
          <Select defaultValue={defaultCurrency}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Existing contact name" name="contactName" error={e?.contactName}>
          <Input />
        </Field>
        <Field label="Known client email" name="email" error={e?.email}>
          <Input type="email" />
        </Field>
        <Field label="Known WhatsApp number" name="whatsapp" error={e?.whatsapp} hint="With country code">
          <Input type="tel" />
        </Field>
        <Field label="Discovery meeting notes" name="discoveryNotes" error={e?.discoveryNotes} className="sm:col-span-2">
          <Textarea rows={3} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          <ScanSearch className="h-4 w-4" />
          {pending ? "Checking URL…" : "Start audit"}
        </Button>
      </div>
    </form>
  );
}
