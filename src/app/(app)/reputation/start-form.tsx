"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import { startReputationAction } from "./actions";

export function StartReputationForm() {
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ businessName: "", websiteUrl: "", gbpLink: "" });
  const router = useRouter();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await startReputationAction(form);
          if (!r.ok) return void toast.error(r.error);
          if (r.note) toast.info(r.note, { duration: 9000 });
          router.push(`/prospects/${r.prospectId}/research?tab=gbp`);
        });
      }}
    >
      <Field label="Google Maps / Business Profile link" name="gbpLink" hint="From the profile's Share button. Optional — without a Places key, paste reviews or add screenshots on the next page.">
        <Input value={form.gbpLink} onChange={set("gbpLink")} placeholder="https://maps.app.goo.gl/…" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" name="businessName" required>
          <Input value={form.businessName} onChange={set("businessName")} required placeholder="Desert Balloon Rides" />
        </Field>
        <Field label="Website" name="websiteUrl" required>
          <Input value={form.websiteUrl} onChange={set("websiteUrl")} required placeholder="balloonridedubai.com" />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Start review check
      </Button>
    </form>
  );
}
