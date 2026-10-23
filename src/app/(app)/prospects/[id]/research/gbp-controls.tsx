"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, MapPinned, PenLine } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { fetchGbpAction, saveManualGbpAction } from "./actions";

export function FetchGbpForm({ prospectId, defaultQueries, ready }: { prospectId: string; defaultQueries: string[]; ready: boolean }) {
  const [queries, setQueries] = useState(defaultQueries.join("\n"));
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <Field label="Google Maps searches to check (one per line, up to 3)" name="gbpQueries" hint="Where does the business appear on Google Maps for these searches?">
        <Textarea rows={3} value={queries} onChange={(e) => setQueries(e.target.value)} placeholder="dentist leeds" />
      </Field>
      <Button
        disabled={pending || !ready}
        title={ready ? undefined : "Add a Google key with the Places API on the Integrations page"}
        onClick={() =>
          start(async () => {
            const r = await fetchGbpAction(prospectId, queries);
            if (r.ok) {
              toast.success(r.message);
              router.refresh();
            } else toast.error(r.error);
          })
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinned className="h-4 w-4" />} {pending ? "Fetching from Google…" : "Fetch from Google"}
      </Button>
    </div>
  );
}

const yesNo = (name: string, label: string) => (
  <Field label={label} name={name}>
    <Select defaultValue="">
      <option value="">Not sure</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </Select>
  </Field>
);

export function ManualGbpForm({ prospectId, businessName, defaultQuery, startOpen }: { prospectId: string; businessName: string; defaultQuery: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium text-primary" aria-expanded={open}>
        <PenLine className="h-4 w-4" /> Enter the profile by hand (free, no key needed)
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <form
          ref={ref}
          className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await saveManualGbpAction(prospectId, fd);
              if (r.ok) {
                toast.success(r.message);
                router.refresh();
              } else toast.error(r.error);
            });
          }}
        >
          <p className="text-sm text-muted sm:col-span-3">Open the business on Google Maps and copy what you see. Leave anything you are unsure about empty — only what you enter is used.</p>
          <Field label="Name on Google" name="name" className="sm:col-span-2">
            <Input defaultValue={businessName} />
          </Field>
          <Field label="Main category" name="category">
            <Input placeholder="e.g. Dentist" />
          </Field>
          <Field label="Rating (1–5)" name="rating">
            <Input type="number" step="0.1" min={1} max={5} placeholder="4.3" />
          </Field>
          <Field label="Number of reviews" name="reviewCount">
            <Input type="number" min={0} placeholder="27" />
          </Field>
          <Field label="Number of photos" name="photoCount">
            <Input type="number" min={0} placeholder="8" />
          </Field>
          {yesNo("hasHours", "Opening hours listed?")}
          {yesNo("hasWebsite", "Website linked?")}
          {yesNo("hasPhone", "Phone number listed?")}
          <Field label="Google Maps search you tried" name="rankQuery" className="sm:col-span-2" hint="e.g. the main service + city">
            <Input defaultValue={defaultQuery} />
          </Field>
          <Field label="Its position (empty = not in top 20)" name="rankPosition">
            <Input type="number" min={1} max={100} />
          </Field>
          <Field label="Profile link (optional)" name="mapsUrl" className="sm:col-span-3">
            <Input placeholder="https://maps.app.goo.gl/…" />
          </Field>
          <Field
            label="Negative reviews (optional)"
            name="badReviewsText"
            className="sm:col-span-3"
            hint="Paste each review separated by a blank line. Start with the stars, e.g. “2★ Waited an hour and nobody called back.”"
          >
            <Textarea rows={5} />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Saving…" : "Save business profile"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
