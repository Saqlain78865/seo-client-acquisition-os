"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { Provider } from "@/lib/integrations";
import { EmailHealthView } from "@/components/email-health-view";
import { disconnectAction, driveBackupNowAction, ownEmailHealthAction, saveApiKeyAction, saveGmailSmtpAction, saveGoogleAppAction, saveSmtpAction, testConnectionAction, type IntegrationState } from "./actions";

function useFeedback(state: IntegrationState) {
  useEffect(() => {
    if (state?.ok && state.message) toast.success(state.message);
  }, [state]);
}

function SubmitRow({ pending, label, connected }: { pending: boolean; label: string; connected: boolean }) {
  return (
    <div className="flex items-center gap-2 sm:col-span-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Checking with the provider…" : connected ? `Update & re-test` : label}
      </Button>
      <span className="text-xs text-muted">Credentials are verified before they are saved, then stored encrypted.</span>
    </div>
  );
}

export function GmailSmtpForm({ connected, defaultEmail, disabled }: { connected: boolean; defaultEmail?: string | null; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveGmailSmtpAction, undefined);
  useFeedback(state);
  const e = state?.fieldErrors;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" noValidate>
      {state?.error && <Alert tone="danger" className="sm:col-span-2">{state.error}</Alert>}
      <fieldset disabled={disabled} className="contents">
        <Field label="Gmail address" name="user" id="gmail-user" error={e?.user}>
          <Input type="email" defaultValue={defaultEmail ?? ""} autoComplete="off" />
        </Field>
        <Field label="App Password" name="pass" id="gmail-pass" error={e?.pass} hint={connected ? "Saved — enter it again only to change it" : "16 letters from Google, not your normal password"}>
          <Input type="password" autoComplete="new-password" placeholder={connected ? "••••••••••••••••" : "abcd efgh ijkl mnop"} />
        </Field>
        <Field label="Sender name (optional)" name="fromName" id="gmail-fromName" error={e?.fromName}>
          <Input placeholder="e.g. Saqlain — Nova SEO" />
        </Field>
        <SubmitRow pending={pending} label="Connect Gmail" connected={connected} />
      </fieldset>
    </form>
  );
}

export function SmtpForm({ connected, config, disabled }: { connected: boolean; config: Record<string, unknown>; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveSmtpAction, undefined);
  useFeedback(state);
  const e = state?.fieldErrors;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" noValidate>
      {state?.error && <Alert tone="danger" className="sm:col-span-2">{state.error}</Alert>}
      <fieldset disabled={disabled} className="contents">
        <Field label="SMTP server" name="host" id="smtp-host" error={e?.host}>
          <Input defaultValue={(config.host as string) ?? ""} placeholder="smtp.example.com" />
        </Field>
        <Field label="Port" name="port" id="smtp-port" error={e?.port}>
          <Input type="number" defaultValue={(config.port as number) ?? 587} />
        </Field>
        <Field label="Username" name="user" id="smtp-user" error={e?.user}>
          <Input autoComplete="off" />
        </Field>
        <Field label="Password" name="pass" id="smtp-pass" error={e?.pass}>
          <Input type="password" autoComplete="new-password" />
        </Field>
        <Field label="Sender email" name="fromEmail" id="smtp-fromEmail" error={e?.fromEmail}>
          <Input type="email" defaultValue={(config.fromEmail as string) ?? ""} />
        </Field>
        <Field label="Sender name" name="fromName" id="smtp-fromName" error={e?.fromName}>
          <Input defaultValue={(config.fromName as string) ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="secure" defaultChecked={!!config.secure} className="h-4 w-4" /> Use SSL/TLS from the start (usually port 465)
        </label>
        <SubmitRow pending={pending} label="Connect SMTP" connected={connected} />
      </fieldset>
    </form>
  );
}

export function GoogleAppForm({ connected, disabled }: { connected: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveGoogleAppAction, undefined);
  useFeedback(state);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" noValidate>
      {state?.error && <Alert tone="danger" className="sm:col-span-2">{state.error}</Alert>}
      <fieldset disabled={disabled} className="contents">
        <Field label="Client ID" name="clientId" error={state?.fieldErrors?.clientId} hint={connected ? "Saved — paste again only to replace it" : "…apps.googleusercontent.com"}>
          <Input autoComplete="off" />
        </Field>
        <Field label="Client Secret" name="clientSecret" error={state?.fieldErrors?.clientSecret} hint="Stored encrypted on this PC, never shown again">
          <Input type="password" autoComplete="off" />
        </Field>
        <SubmitRow pending={pending} label="Save" connected={connected} />
      </fieldset>
    </form>
  );
}

export function ApiKeyForm({ provider, connected, disabled }: { provider: "GEMINI" | "PAGESPEED" | "PLACES"; connected: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveApiKeyAction.bind(null, provider), undefined);
  useFeedback(state);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" noValidate>
      {state?.error && <Alert tone="danger" className="sm:col-span-2">{state.error}</Alert>}
      <fieldset disabled={disabled} className="contents">
        <Field label="API key" name="apiKey" id={`${provider.toLowerCase()}-apiKey`} error={state?.fieldErrors?.apiKey} hint={connected ? "Saved — paste a new key only to replace it" : undefined} className="sm:col-span-2">
          <Input type="password" autoComplete="off" />
        </Field>
        <SubmitRow pending={pending} label="Save & test key" connected={connected} />
      </fieldset>
    </form>
  );
}

export function ConnectionButtons({ provider, canTest }: { provider: Provider; canTest: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<IntegrationState>) =>
    start(async () => {
      const r = await fn();
      if (r?.ok) toast.success(r.message ?? "Done");
      else if (r?.error) toast.error(r.error);
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      {canTest && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => testConnectionAction(provider))}>
          Test connection
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} className="text-danger" onClick={() => confirm("Disconnect and delete the stored credentials?") && run(() => disconnectAction(provider))}>
        Disconnect
      </Button>
    </div>
  );
}

export function DriveBackupNow({ lastBackupAt, lastBackupName }: { lastBackupAt: string | null; lastBackupName: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted">{lastBackupAt ? `Last backup: ${new Date(lastBackupAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${lastBackupName ? ` (${lastBackupName})` : ""}` : "No backup yet — the first one runs within 15 minutes."}</p>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await driveBackupNowAction();
            if (r?.ok) toast.success(r.message ?? "Backed up");
            else if (r?.error) toast.error(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Backing up…" : "Back up now"}
      </Button>
    </div>
  );
}

export function OwnEmailHealth() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ health: import("@/lib/email-health").EmailHealth; note: string | null } | null>(null);
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await ownEmailHealthAction();
            if (!r.ok) return void toast.error(r.error);
            setResult({ health: r.health, note: r.note });
          })
        }
      >
        {pending ? "Checking DNS…" : "Check my email domain"}
      </Button>
      {result && (
        <>
          {result.note && <p className="text-xs text-warning">{result.note}</p>}
          <EmailHealthView health={result.health} />
        </>
      )}
    </div>
  );
}
