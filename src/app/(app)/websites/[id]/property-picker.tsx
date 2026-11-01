"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Select } from "@/components/ui";
import { linkWebsiteAction, websitePropertiesAction } from "../actions";

/** Links the website to its own Search Console property; properties of other sites are never offered. */
export function PropertyPicker({ websiteId, domain, current }: { websiteId: string; domain: string; current: string | null }) {
  const [pending, start] = useTransition();
  const [own, setOwn] = useState<string[] | null>(null);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();

  const load = () =>
    start(async () => {
      const r = await websitePropertiesAction(websiteId);
      if (!r.ok) return void toast.error(r.error);
      if (!r.own.length) {
        setNote(
          r.total
            ? `The connected Google account sees ${r.total} Search Console propert${r.total === 1 ? "y" : "ies"}, but none for ${domain}. Add this site in Search Console, or ask the owner to add your Google account as a user.`
            : "The connected Google account has no Search Console properties yet.",
        );
        return;
      }
      setNote(null);
      setOwn(r.own);
      setChoice(r.suggested ?? r.own[0]);
    });

  return (
    <div className="space-y-2">
      {own ? (
        <div className="flex flex-wrap gap-2">
          <Select value={choice} onChange={(e) => setChoice(e.target.value)} className="min-w-64 flex-1" aria-label="Search Console property">
            {own.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Button
            disabled={pending || !choice}
            onClick={() =>
              start(async () => {
                const r = await linkWebsiteAction(websiteId, choice);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Search Console linked");
                setOwn(null);
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Link
          </Button>
        </div>
      ) : (
        <Button variant={current ? "secondary" : "primary"} size={current ? "sm" : "md"} disabled={pending} onClick={load}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {current ? "Change property" : `Link ${domain}'s Search Console`}
        </Button>
      )}
      {note && <p className="text-sm text-warning">{note}</p>}
    </div>
  );
}
