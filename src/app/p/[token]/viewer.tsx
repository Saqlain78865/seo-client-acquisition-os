"use client";

import { useEffect, useRef } from "react";

/**
 * The proposal in a sandboxed frame. When `track` is on, reading time per section (posted by the
 * frame's script) is sent to the server every few seconds — totals only, no personal data.
 */
export function ProposalViewer({ token, track }: { token: string; track: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!track) return;
    const visitorKey = crypto.randomUUID();
    const device = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches ? "MOBILE" : "DESKTOP";
    let pending: Record<string, number> = {};
    const send = (beacon: boolean) => {
      if (!Object.keys(pending).length) return;
      const body = JSON.stringify({ visitorKey, device, sections: pending });
      pending = {};
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(`/p/${token}/read`, new Blob([body], { type: "application/json" }));
      else fetch(`/p/${token}/read`, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string; sections?: Record<string, unknown> };
      if (d?.type !== "proposal-read" || !d.sections) return;
      for (const [k, ms] of Object.entries(d.sections)) if (typeof ms === "number" && /^[a-z_]{1,40}$/.test(k)) pending[k] = (pending[k] ?? 0) + ms;
      send(false);
    };
    const onHide = () => send(true);
    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onHide);
      send(true);
    };
  }, [token, track]);

  return <iframe ref={frame} title="Proposal" src={`/p/${token}/html`} sandbox="allow-scripts" className="block h-[calc(100vh-57px)] w-full border-0" />;
}
