"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader, Select } from "@/components/ui";
import { requestVideoAction } from "./video-actions";

type Video = {
  id: string;
  status: string;
  seconds: number | null;
  error: string | null;
  createdAt: string;
};

/** One-minute MP4 of the website and its biggest problems, to send on WhatsApp or by email. */
export function VideoCard({
  prospectId,
  canMake,
  video,
}: {
  prospectId: string;
  canMake: boolean;
  video: Video | null;
}) {
  const [pending, start] = useTransition();
  const [voice, setVoice] = useState<"female" | "male" | "none">("female");
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
      const r = await requestVideoAction(prospectId, voice);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Making the video — a few minutes for many issues");
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
        description="An MP4 with a voice-over: the website, the phone view and every problem the audit found, ending with your contact details. More issues make a longer video."
        action={
          <div className="flex items-center gap-2">
            <Select
              value={voice}
              onChange={(e) =>
                setVoice(e.target.value as "female" | "male" | "none")
              }
              aria-label="Voice"
              className="h-8 w-auto py-0 text-xs"
              disabled={pending || working}
            >
              <option value="female">Female voice</option>
              <option value="male">Male voice</option>
              <option value="none">No voice</option>
            </Select>
            <Button
              size="sm"
              variant={video?.status === "READY" ? "secondary" : "primary"}
              disabled={!canMake || pending || working}
              onClick={make}
            >
              {pending || working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Clapperboard className="h-4 w-4" />
              )}{" "}
              {working
                ? "Making…"
                : video?.status === "READY"
                  ? "Make again"
                  : "Make video"}
            </Button>
          </div>
        }
      />
      <div className="space-y-3 p-5 text-sm">
        {!canMake && (
          <p className="text-muted">
            Run a website audit first — the video shows its findings and
            screenshots.
          </p>
        )}
        {working && (
          <p className="text-muted">
            Recording the website, speaking the voice-over and encoding the
            video… this page updates by itself.
          </p>
        )}
        {video?.status === "FAILED" && (
          <p className="text-danger">
            {video.error ?? "The video could not be made."}
          </p>
        )}
        {video?.status === "READY" && (
          <>
            <video
              src={`/api/videos/${video.id}`}
              controls
              preload="metadata"
              className="w-full rounded-xl bg-black"
            />
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`/api/videos/${video.id}?download=1`}
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <Download className="h-4 w-4" /> Download MP4
              </a>
              <span className="text-xs text-muted">
                {video.seconds
                  ? `${Math.floor(video.seconds / 60)}:${String(video.seconds % 60).padStart(2, "0")} min · `
                  : ""}
                Attach it in WhatsApp (📎 → Document or Gallery) or to an email.
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
