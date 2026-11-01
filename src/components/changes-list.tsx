"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";

export type ChangeItem = { id: string; url: string; label: string; before: string | null; after: string | null; at: string };
type CheckResult = ({ ok: true } & { baseline: boolean; changes: number; pages: number }) | { ok: false; error: string };

/** The change log of a website with a "check now" button (used for My Websites and won clients). */
export function ChangesList({ changes, checkedAt, note, check }: { changes: ChangeItem[]; checkedAt: string | null; note: string; check: () => Promise<CheckResult> }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3 text-sm">
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Activity className="h-4 w-4 text-primary" /> Website changes
      </h3>
      <p className="text-xs text-muted">
        {note}
        {checkedAt ? ` · last check ${new Date(checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
      </p>
      {changes.length === 0 ? (
        <p className="text-muted">{checkedAt ? "No changes found since the first check." : "The first check records how the site looks today; later checks list what changed."}</p>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {changes.map((c) => (
            <li key={c.id} className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs">
                <b className="font-medium">{c.label}</b> · <span className="text-muted">{new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </p>
              <p className="truncate text-xs text-muted" title={c.url}>
                {c.url.replace(/^https?:\/\//, "")}
              </p>
              {(c.before || c.after) && (
                <p className="mt-0.5 line-clamp-2 text-xs">
                  {c.before && <span className="text-danger line-through decoration-1">{c.before}</span>}
                  {c.before && c.after && " → "}
                  {c.after && <span className="text-success">{c.after}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            toast.info("Checking the live website — this takes a minute or two…");
            const r = await check();
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.baseline ? `First check done: ${r.pages} pages recorded. Changes will show from the next check.` : `${r.changes} change${r.changes === 1 ? "" : "s"} found on ${r.pages} pages`);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check for changes now
      </Button>
    </div>
  );
}
