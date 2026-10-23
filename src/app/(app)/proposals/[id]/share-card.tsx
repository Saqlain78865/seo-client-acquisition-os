"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Copy, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { createShareAction, revokeShareAction } from "./send/actions";

export function ShareCard({
  proposalId,
  state,
  url,
  qr,
  expiresAt,
  views,
  lastViewedAt,
  sharedVersion,
}: {
  proposalId: string;
  state: "ACTIVE" | "EXPIRED" | "REVOKED" | "NONE";
  url: string | null;
  qr: string | null;
  expiresAt: string | null;
  views: number;
  lastViewedAt: string | null;
  sharedVersion: number | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const create = (days: number) =>
    start(async () => {
      const r = await createShareAction(proposalId, days);
      if (r.ok) toast.success("Share link created");
      else toast.error(r.error);
      router.refresh();
    });

  return (
    <div className="space-y-3 p-5 text-sm">
      {state === "ACTIVE" && url ? (
        <>
          <div className="flex items-center gap-2">
            <Badge tone="success">Active</Badge>
            <span className="text-xs text-muted">
              v{sharedVersion} · expires {formatDate(expiresAt)} · {views} view{views === 1 ? "" : "s"}
              {lastViewedAt ? `, last ${formatDate(lastViewedAt, true)}` : ""}
            </span>
          </div>
          <Input readOnly value={url} aria-label="Proposal share link" onFocus={(e) => e.currentTarget.select()} className="h-8 text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(url).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Copy failed — select the link manually"),
                );
              }}
            >
              <Copy className="h-4 w-4" /> Copy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={pending}
              onClick={() =>
                confirm("Revoke this link? The client will no longer be able to open it.") &&
                start(async () => {
                  const r = await revokeShareAction(proposalId);
                  if (r.ok) toast.success("Link revoked");
                  router.refresh();
                })
              }
            >
              <Link2Off className="h-4 w-4" /> Revoke
            </Button>
          </div>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element -- generated data URI
            <img src={qr} alt="QR code that opens the proposal link" className="h-36 w-36 rounded border border-border bg-white p-1" />
          )}
          <p className="text-xs text-muted">The QR code contains only this link — no passwords or tokens for your accounts.</p>
        </>
      ) : (
        <>
          <p className="text-muted">
            {state === "EXPIRED" ? "The previous link has expired." : state === "REVOKED" ? "The previous link was revoked." : "Share a read-only link (and QR code) to this version."} Creating a link locks this version.
          </p>
          <div className="flex flex-wrap gap-2">
            {[7, 14, 30].map((d) => (
              <Button key={d} size="sm" variant="secondary" disabled={pending} onClick={() => create(d)}>
                {d} days
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
