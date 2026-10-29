"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import { startReputationAction } from "./actions";

/** One field: the business's Google Maps / Business Profile link (or a review link). */
export function StartReputationForm({ placesReady }: { placesReady: boolean }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState("");
  const router = useRouter();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await startReputationAction(link);
          if (!r.ok) return void toast.error(r.error);
          if (r.note) toast.info(r.note, { duration: 9000 });
          router.push(`/prospects/${r.prospectId}/research?tab=gbp`);
        });
      }}
    >
      <Field
        label="Google Maps / Business Profile link"
        name="link"
        required
        hint={
          placesReady
            ? "On the profile press Share and copy the link. Rating and reviews are read from Google."
            : "On the profile press Share and copy the link. Then add screenshots of the bad reviews — AI reads them."
        }
      >
        <Input value={link} onChange={(e) => setLink(e.target.value)} required placeholder="https://maps.app.goo.gl/…" className="h-11 text-base" autoFocus />
      </Field>
      <Button type="submit" disabled={pending || !link.trim()}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Check reviews
      </Button>
    </form>
  );
}
