"use client";

import { useEffect, useState, useTransition } from "react";
import { ArchiveRestore, DownloadCloud, HardDriveDownload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader } from "@/components/ui";

type Bridge = {
  version: () => Promise<{ version: string; dataDir: string; updates: boolean }>;
  backup: () => Promise<{ ok: boolean; file?: string; canceled?: boolean; error?: string }>;
  restore: () => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
  checkForUpdates: () => Promise<{ status: "latest" | "downloading" | "error" | "unavailable"; current: string; latest?: string | null; error?: string }>;
};

const bridge = () => (typeof window === "undefined" ? undefined : (window as unknown as { leadliftDesktop?: Bridge }).leadliftDesktop);

/** Backup, restore and updates — shown only inside the LeadLift desktop app (which provides the bridge). */
export function DesktopCard() {
  const [info, setInfo] = useState<{ version: string; dataDir: string; updates: boolean } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    bridge()?.version().then(setInfo, () => undefined);
  }, []);

  const b = bridge();
  if (!info || !b) return null;
  return (
    <Card>
      <CardHeader title="Backup & updates" description={`LeadLift ${info.version} on this PC`} />
      <div className="space-y-3 p-5 text-sm">
        <p className="text-xs text-muted">One file with all prospects, audits, proposals, PDFs and settings. Keep a copy on a USB drive or Google Drive.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await b.backup();
                if (r.ok) toast.success("Backup saved — the folder is open.");
                else if (r.error) toast.error(r.error);
              })
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />} Back up now
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => void (await b.restore()))}>
            <ArchiveRestore className="h-4 w-4" /> Restore…
          </Button>
        </div>
        <div className="border-t border-border pt-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await b.checkForUpdates();
                if (r.status === "downloading") toast.success(`LeadLift ${r.latest} is downloading — you'll be asked to restart.`);
                else if (r.status === "latest") toast.success(`You have the latest version (${r.current}).`);
                else if (r.status === "unavailable") toast.info("Updates work in the installed app.");
                else toast.error(`Could not check for updates: ${r.error}`);
              })
            }
          >
            <DownloadCloud className="h-4 w-4" /> Check for updates
          </Button>
          <p className="mt-1 text-xs text-muted">New versions download by themselves and install when you agree. Your data is copied first.</p>
        </div>
      </div>
    </Card>
  );
}
