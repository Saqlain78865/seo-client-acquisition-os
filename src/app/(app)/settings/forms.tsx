"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { CURRENCIES } from "@/lib/constants";
import { ThemePicker } from "@/components/theme-picker";
import { saveProfileAction, sendDigestNowAction, uploadLogoAction, type SettingsState } from "./actions";

function useToastOnOk(state: SettingsState, message: string, reset?: () => void) {
  useEffect(() => {
    if (state?.ok) {
      toast.success(message);
      reset?.();
    }
  }, [state, message, reset]);
}

type ProfileDefaults = {
  companyName: string;
  consultantName: string;
  companyEmail: string;
  companyPhone: string;
  companyWebsite: string;
  defaultCurrency: string;
  proposalTheme: string;
  brandColor: string;
  weeklyDigest: boolean;
  crawlPageLimit: number;
  crawlDelayMs: number;
};

export function ProfileForm({ defaults, disabled, logo }: { defaults: ProfileDefaults; disabled: boolean; logo: string | null }) {
  const [state, action, pending] = useActionState(saveProfileAction, undefined);
  const [theme, setTheme] = useState(defaults.proposalTheme);
  const [brandColor, setBrandColor] = useState(defaults.brandColor);
  useToastOnOk(state, "Settings saved");
  const e = state?.fieldErrors;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      {state?.error && <Alert tone="danger" className="sm:col-span-2">{state.error}</Alert>}
      <fieldset disabled={disabled} className="contents">
        <Field label="Company / agency name" name="companyName" error={e?.companyName}>
          <Input defaultValue={defaults.companyName} />
        </Field>
        <Field label="Consultant name" name="consultantName" error={e?.consultantName}>
          <Input defaultValue={defaults.consultantName} />
        </Field>
        <Field label="Business email" name="companyEmail" error={e?.companyEmail}>
          <Input type="email" defaultValue={defaults.companyEmail} />
        </Field>
        <Field label="Phone" name="companyPhone" error={e?.companyPhone}>
          <Input defaultValue={defaults.companyPhone} />
        </Field>
        <Field label="Website" name="companyWebsite" error={e?.companyWebsite}>
          <Input defaultValue={defaults.companyWebsite} placeholder="https://" />
        </Field>
        <Field label="Default proposal currency" name="defaultCurrency" error={e?.defaultCurrency}>
          <Select defaultValue={defaults.defaultCurrency}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium">Proposal look</p>
          <p className="text-xs text-muted">New proposals use this theme and your logo. You can still change the theme on each proposal.</p>
          <input type="hidden" name="proposalTheme" value={theme} />
          <input type="hidden" name="brandColor" value={brandColor} />
          <ThemePicker value={theme} onChange={setTheme} brandColor={brandColor || null} onBrandColorChange={setBrandColor} logo={logo} disabled={disabled} />
          {(e?.proposalTheme || e?.brandColor) && <p className="text-xs text-danger">{e?.brandColor?.[0] ?? "Choose a theme"}</p>}
        </div>
        <Field label="Audit page limit" name="crawlPageLimit" error={e?.crawlPageLimit} hint="5–200 pages per audit">
          <Input type="number" min={5} max={200} defaultValue={defaults.crawlPageLimit} />
        </Field>
        <Field label="Delay between requests (ms)" name="crawlDelayMs" error={e?.crawlDelayMs} hint="Be polite to prospect servers (min 250)">
          <Input type="number" min={250} max={10000} defaultValue={defaults.crawlDelayMs} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/50 p-4 sm:col-span-2">
          <label className="flex flex-1 items-start gap-3 text-sm">
            <input type="checkbox" name="weeklyDigest" defaultChecked={defaults.weeklyDigest} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
            <span>
              <span className="font-medium">Weekly summary email</span>
              <span className="block text-xs text-muted">Every Monday morning: proposals opened and accepted, questions waiting, and who needs a follow-up. Sent from your connected email account to owners and admins.</span>
            </span>
          </label>
          <DigestNowButton disabled={disabled} />
        </div>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function DigestNowButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await sendDigestNowAction();
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      <Mail className="h-4 w-4" /> {pending ? "Sending…" : "Send this week's summary now"}
    </Button>
  );
}

export function LogoForm() {
  const [state, action, pending] = useActionState(uploadLogoAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useToastOnOk(state, "Logo uploaded", () => ref.current?.reset());
  return (
    <form ref={ref} action={action} className="space-y-2">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Upload logo" name="logo" error={state?.fieldErrors?.logo}>
        <Input type="file" accept="image/png,image/jpeg,image/webp" className="h-auto py-1.5 text-xs" />
      </Field>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        Upload
      </Button>
    </form>
  );
}

