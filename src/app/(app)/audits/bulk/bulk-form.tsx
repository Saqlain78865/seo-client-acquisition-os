"use client";

import { useActionState, useState } from "react";
import { Layers } from "lucide-react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { startBulkAuditAction } from "../actions";

export function BulkAuditForm({ max }: { max: number }) {
  const [state, action, pending] = useActionState(startBulkAuditAction, undefined);
  const [text, setText] = useState("");
  const count = new Set(text.split(/[\s,;]+/).map((t) => t.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter((t) => t.includes("."))).size;

  return (
    <form action={action} className="space-y-5">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Websites" name="sites" required hint={`One per line (or separated by commas). Up to ${max} websites.`}>
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"dentist-one.com\nhttps://www.clinic-two.co.uk\nplumber-three.ae"} className="font-mono text-sm" />
      </Field>
      <Field label="Name for this list (optional)" name="name">
        <Input placeholder="e.g. Dubai dentists — October" maxLength={120} />
      </Field>
      <label className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-2/50 p-3.5 text-sm">
        <input type="checkbox" name="autoProposal" defaultChecked className="mt-0.5 h-4 w-4" />
        <span>
          <span className="font-medium">Prepare a proposal for every website</span>
          <span className="block text-xs text-muted">All websites are checked at the same time. When they are done, you review the list and send all proposals in one go — nothing is sent before that.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {count === 0 ? "Paste websites to start." : <><span className="font-semibold text-text">{count}</span> unique website{count === 1 ? "" : "s"}{count > max ? ` — only ${max} allowed` : ""}</>}
        </p>
        <Button type="submit" size="lg" disabled={pending || count === 0 || count > max}>
          <Layers className="h-4 w-4" /> {pending ? "Checking websites…" : `Audit ${count || ""} website${count === 1 ? "" : "s"}`}
        </Button>
      </div>
    </form>
  );
}
