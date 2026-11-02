"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader } from "@/components/ui";
import { requestVideoAction } from "./video-actions";

type Video = { id: string; status: string; seconds: number | null; error: string | null; createdAt: string };

/** One-minute MP4 of the website and its biggest problems, to send on WhatsApp or by email. */
export function VideoCard({ prospectId, canMake, video }: { prospectId: string; canMake: boolean; video: Video | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const working = video?.status === "QUEUED" || video?.status === "RUNNING";
  // While the video is being made, the page checks again every few seconds.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [working, router]);

  const make = () =>
    start(async () => {
      const r = await requestVideoAction(prospectId);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Making the video — about a minute");
      router.refresh();
    });

  return (
    <Card id="video">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4" /> Audit video
          </span>
        }
        description="A one-minute MP4: the website, the phone view and the top problems from the audit, ending with your contact details."
        action={
          <Button size="sm" variant={video?.status === "READY" ? "secondary" : "primary"} disabled={!canMake || pending || working} onClick={make}>
            {pending || working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />} {working ? "Making…" : video?.status === "READY" ? "Make again" : "Make video"}
          </Button>
        }
      />
      <div className="space-y-3 p-5 text-sm">
        {!canMake && <p className="text-muted">Run a website audit first — the video shows its findings and screenshots.</p>}
        {working && <p className="text-muted">Recording the website and encoding the video… this page updates by itself.</p>}
        {video?.status === "FAILED" && <p className="text-danger">{video.error ?? "The video could not be made."}</p>}
        {video?.status === "READY" && (
          <>
            <video src={`/api/videos/${video.id}`} controls preload="metadata" className="w-full rounded-xl bg-black" />
            <div className="flex flex-wrap items-center gap-3">
              <a href={`/api/videos/${video.id}?download=1`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                <Download className="h-4 w-4" /> Download MP4
              </a>
              <span className="text-xs text-muted">{video.seconds ? `${video.seconds} seconds · ` : ""}Attach it in WhatsApp (📎 → Document or Gallery) or to an email.</span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
