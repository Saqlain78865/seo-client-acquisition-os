"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { PLACEHOLDERS, renderTemplate, type TemplateVars } from "@/lib/messaging/templates";
import { deleteTemplateAction, saveTemplateAction, setDefaultTemplateAction } from "./actions";

const SAMPLE: TemplateVars = {
  clientName: "Sara",
  businessName: "Bright Smile Dental",
  websiteUrl: "https://brightsmile.example",
  proposalTitle: "SEO proposal for Bright Smile Dental",
  proposalDate: "22 October 2026",
  proposalLink: "https://your-app.example/p/AbC123…",
  auditSummary: "I found 6 specific improvements, including missing page titles and slow mobile pages.",
  consultantName: "Your name",
  companyName: "Your company",
};

type T = { id: string; channel: string; name: string; subject: string | null; body: string; isDefault: boolean; version: number; updatedAt: string };

export function TemplateEditor({ template, onDone }: { template: T | null; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveTemplateAction.bind(null, template?.id ?? null), undefined);
  const [channel, setChannel] = useState(template?.channel ?? "EMAIL");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  useEffect(() => {
    if (state?.ok) {
      toast.success(template ? "Template saved (new revision)" : "Template created");
      onDone?.();
    }
  }, [state, template, onDone]);
  const e = state?.fieldErrors;
  const preview = renderTemplate(`${channel === "EMAIL" ? `Subject: ${subject}\n\n` : ""}${body}`, SAMPLE);

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-2">
      {state?.error && <Alert tone="danger" className="lg:col-span-2">{state.error}</Alert>}
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" name="name" error={e?.name}>
            <Input defaultValue={template?.name} />
          </Field>
          <Field label="Channel" name="channel" error={e?.channel}>
            <Select value={channel} onChange={(ev) => setChannel(ev.target.value)} disabled={!!template}>
              <option value="EMAIL">Email</option>
              <option value="WHATSAPP">WhatsApp</option>
            </Select>
          </Field>
        </div>
        {template && <input type="hidden" name="channel" value={channel} />}
        {channel === "EMAIL" && (
          <Field label="Subject" name="subject" error={e?.subject}>
            <Input value={subject} onChange={(ev) => setSubject(ev.target.value)} />
          </Field>
        )}
        <Field label="Message" name="body" error={e?.body}>
          <Textarea rows={10} value={body} onChange={(ev) => setBody(ev.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1">
          {Object.entries(PLACEHOLDERS).map(([k, desc]) => (
            <button key={k} type="button" title={desc} onClick={() => setBody((b) => `${b}{{${k}}}`)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-primary hover:text-primary">
              {`{{${k}}}`}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={pending}>
          {template ? "Save changes" : "Create template"}
        </Button>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Preview with sample values</p>
        <pre className="whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-4 font-sans text-sm">{preview.text}</pre>
        {preview.unknown.length > 0 && <p className="mt-1 text-xs text-danger">Unknown: {preview.unknown.map((u) => `{{${u}}}`).join(", ")}</p>}
      </div>
    </form>
  );
}

export function TemplateCard({ t }: { t: T }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{t.name}</p>
        <Badge tone={t.channel === "EMAIL" ? "primary" : "success"}>{t.channel === "EMAIL" ? "Email" : "WhatsApp"}</Badge>
        {t.isDefault && <Badge>default</Badge>}
        <span className="text-xs text-muted">revision {t.version}</span>
        <div className="ml-auto flex gap-1">
          {!t.isDefault && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => setDefaultTemplateAction(t.id))}>
              Make default
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            disabled={pending}
            onClick={() =>
              confirm(`Delete “${t.name}”?`) &&
              start(async () => {
                const r = await deleteTemplateAction(t.id);
                if (r?.error) toast.error(r.error);
              })
            }
          >
            Delete
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="mt-4">
          <TemplateEditor template={t} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{t.subject ? `${t.subject} — ` : ""}{t.body}</p>
      )}
    </Card>
  );
}
