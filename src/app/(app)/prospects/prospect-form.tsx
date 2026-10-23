"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { Alert, Button, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { CURRENCIES, LEAD_SOURCES } from "@/lib/constants";
import type { FormState } from "./actions";

export type ProspectDefaults = Partial<{
  businessName: string;
  websiteUrl: string;
  industry: string;
  country: string;
  city: string;
  primaryServices: string;
  leadSource: string;
  notes: string;
  estimatedValue: number;
  currency: string;
}>;

export function ProspectForm({
  action,
  defaults = {},
  withContacts,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults?: ProspectDefaults;
  withContacts: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const confirmRef = useRef<HTMLInputElement>(null);
  const e = state?.fieldErrors;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.duplicates && (
        <Alert tone="warning" title="This prospect may already exist">
          <ul className="mt-1 list-disc pl-5">
            {state.duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/prospects/${d.id}`} className="font-medium underline" target="_blank">
                  {d.businessName}
                </Link>{" "}
                <span className="text-muted">({d.websiteUrl})</span>
              </li>
            ))}
          </ul>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              if (confirmRef.current) confirmRef.current.value = "1";
            }}
          >
            Create anyway
          </Button>
        </Alert>
      )}
      <input type="hidden" name="confirmDuplicate" ref={confirmRef} defaultValue="0" />

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" name="businessName" error={e?.businessName} required>
          <Input defaultValue={defaults.businessName} />
        </Field>
        <Field label="Website URL" name="websiteUrl" error={e?.websiteUrl} required hint="e.g. example.com">
          <Input defaultValue={defaults.websiteUrl} inputMode="url" />
        </Field>
        <Field label="Industry" name="industry" error={e?.industry}>
          <Input defaultValue={defaults.industry} />
        </Field>
        <Field label="Primary services" name="primaryServices" error={e?.primaryServices} hint="Comma-separated">
          <Input defaultValue={defaults.primaryServices} />
        </Field>
        <Field label="Country" name="country" error={e?.country}>
          <Input defaultValue={defaults.country} />
        </Field>
        <Field label="City / region" name="city" error={e?.city}>
          <Input defaultValue={defaults.city} />
        </Field>
        <Field label="Lead source" name="leadSource" error={e?.leadSource}>
          <Select defaultValue={defaults.leadSource ?? ""}>
            <option value="">Not specified</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Estimated deal value" name="estimatedValue" error={e?.estimatedValue} hint="Your own estimate, not revenue">
            <Input type="number" min={0} step="any" defaultValue={defaults.estimatedValue} />
          </Field>
          <Field label="Currency" name="currency" error={e?.currency}>
            <Select defaultValue={defaults.currency ?? "USD"}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      {withContacts && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Known contact details</h2>
          <p className="mb-3 text-xs text-muted">
            Only enter details you already have. Public details from the website are extracted during the audit.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact name" name="contactName" error={e?.contactName}>
              <Input autoComplete="off" />
            </Field>
            <Field label="Email" name="email" error={e?.email}>
              <Input type="email" autoComplete="off" />
            </Field>
            <Field label="Phone" name="phone" error={e?.phone} hint="Include the country code, e.g. +92…">
              <Input type="tel" autoComplete="off" />
            </Field>
            <Field label="WhatsApp number" name="whatsapp" error={e?.whatsapp} hint="Include the country code">
              <Input type="tel" autoComplete="off" />
            </Field>
          </div>
        </section>
      )}

      <Field label="Notes" name="notes" error={e?.notes}>
        <Textarea defaultValue={defaults.notes} rows={4} />
      </Field>

      <div className="flex justify-end gap-2">
        <Link href={cancelHref} className={buttonClass("ghost")}>
          Cancel
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
