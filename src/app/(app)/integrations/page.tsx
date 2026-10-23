import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { hasRole, requireSession } from "@/lib/auth";
import { listConnections, type ConnectionView, type Provider } from "@/lib/integrations";
import { googleOAuthConfigured, redirectUri } from "@/lib/messaging/google-oauth";
import { formatDate } from "@/lib/utils";
import { Alert, Badge, Card, CardHeader, buttonClass } from "@/components/ui";
import { ApiKeyForm, ConnectionButtons, GmailSmtpForm, SmtpForm } from "./cards";

export const metadata: Metadata = { title: "Integrations" };

const OAUTH_ERRORS: Record<string, string> = {
  forbidden: "Only owners and admins can connect integrations.",
  google_not_configured: "Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (see the steps on the card).",
  oauth_state: "The Google sign-in could not be verified (expired or tampered). Please try again.",
  oauth_denied: "Google access was not granted.",
  oauth_scope: "Gmail permission was not granted. Tick the Gmail checkbox on Google's consent screen.",
  oauth_failed: "Google sign-in failed. Please try again.",
};

function StatusLine({ c, serverKey }: { c: ConnectionView; serverKey?: boolean }) {
  const connected = c.status === "CONNECTED" && c.hasSecret;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {!c.hasSecret && serverKey ? (
        <Badge tone="success">
          <CheckCircle2 className="h-3 w-3" /> Active — server key from .env
        </Badge>
      ) : connected ? (
        <Badge tone="success">
          <CheckCircle2 className="h-3 w-3" /> Connected
        </Badge>
      ) : c.status === "ERROR" ? (
        <Badge tone="danger">
          <XCircle className="h-3 w-3" /> Error
        </Badge>
      ) : (
        <Badge>
          <CircleDashed className="h-3 w-3" /> Not configured
        </Badge>
      )}
      {c.accountLabel && c.hasSecret && <span className="text-muted">{c.accountLabel}</span>}
      {c.lastTestedAt && <span className="text-xs text-muted">· last checked {formatDate(c.lastTestedAt, true)}</span>}
    </div>
  );
}

function IntegrationCard({ title, c, serverKey, capabilities, steps, children, canTest = true, canEdit }: { title: string; c?: ConnectionView; serverKey?: boolean; capabilities: string[]; steps: React.ReactNode; children?: React.ReactNode; canTest?: boolean; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader title={title} description={c ? <StatusLine c={c} serverKey={serverKey} /> : undefined} action={c && c.hasSecret && canEdit ? <ConnectionButtons provider={c.provider as Provider} canTest={canTest} /> : undefined} />
      <div className="space-y-4 p-5">
        {c?.lastError && <Alert tone="danger" title="Last error">{c.lastError}</Alert>}
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">What it enables</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {capabilities.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <details className="rounded-lg bg-surface-2 p-3">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">Setup steps</summary>
            <div className="mt-2 space-y-1 text-sm">{steps}</div>
          </details>
        </div>
        {children}
      </div>
    </Card>
  );
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const c = await listConnections(session.workspace.id);
  const canEdit = hasRole(session, "ADMIN");
  const anyEmail = ["GMAIL_OAUTH", "GMAIL_SMTP", "SMTP"].some((p) => c[p as Provider].hasSecret && c[p as Provider].status === "CONNECTED");

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-muted">Connections are optional — the app works without them, and each card says exactly what is missing. Secrets are encrypted and never shown again after saving.</p>
      </div>
      {sp.error && <Alert tone="danger" className="mb-4">{OAUTH_ERRORS[sp.error] ?? "Something went wrong."}</Alert>}
      {sp.connected === "gmail" && <Alert tone="success" className="mb-4">Gmail connected through Google sign-in.</Alert>}
      {!canEdit && <Alert tone="info" className="mb-4">Only owners and admins can change integrations.</Alert>}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Email</h2>
      {!anyEmail && <Alert tone="warning" className="mb-3">No email account connected yet — proposals can still be downloaded and sent from your own email app.</Alert>}
      <div className="space-y-4">
        <IntegrationCard
          title="Gmail (App Password) — recommended"
          c={c.GMAIL_SMTP}
          canEdit={canEdit}
          capabilities={["Send proposal emails with the PDF attached from your Gmail", "Save drafts into your Gmail Drafts folder", "Sent emails appear in your Gmail “Sent” folder"]}
          steps={
            <ol className="list-decimal space-y-1 pl-5">
              <li>Turn on 2-Step Verification: myaccount.google.com → Security.</li>
              <li>
                Open{" "}
                <a className="text-primary underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                  App passwords
                </a>
                , name it “SEO OS”, and copy the 16-letter password.
              </li>
              <li>For drafts: Gmail → Settings → Forwarding and POP/IMAP → enable IMAP.</li>
              <li>Paste your Gmail address and the App Password below.</li>
            </ol>
          }
        >
          <GmailSmtpForm connected={c.GMAIL_SMTP.hasSecret} defaultEmail={c.GMAIL_SMTP.accountLabel} disabled={!canEdit} />
        </IntegrationCard>

        <IntegrationCard
          title="Gmail via Google sign-in (Gmail API)"
          c={c.GMAIL_OAUTH}
          canEdit={canEdit}
          canTest={false}
          capabilities={["Official Gmail API sending and drafts", "Only the gmail.compose permission is requested (no reading of your inbox)", "Takes priority over the App Password when connected"]}
          steps={
            <ol className="list-decimal space-y-1 pl-5">
              <li>Google Cloud Console → create a project → enable the Gmail API.</li>
              <li>OAuth consent screen → External → add your Gmail as a test user.</li>
              <li>
                Credentials → OAuth client ID → Web application. Authorised redirect URI: <code className="break-all text-xs">{redirectUri()}</code>
              </li>
              <li>Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart the app.</li>
            </ol>
          }
        >
          {googleOAuthConfigured() ? (
            canEdit && (
              <a href="/api/integrations/google/start" className={buttonClass(c.GMAIL_OAUTH.hasSecret ? "secondary" : "primary")}>
                {c.GMAIL_OAUTH.hasSecret ? "Reconnect Google account" : "Connect with Google"}
              </a>
            )
          ) : (
            <p className="text-sm text-muted">Not available until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. The App Password option above works without them.</p>
          )}
        </IntegrationCard>

        <IntegrationCard title="Other email provider (SMTP)" c={c.SMTP} canEdit={canEdit} capabilities={["Send proposal emails from any mailbox that supports SMTP (Outlook, Zoho, cPanel…)"]} steps={<p>Use the SMTP details from your email provider&apos;s help pages.</p>}>
          <SmtpForm connected={c.SMTP.hasSecret} config={c.SMTP.config} disabled={!canEdit} />
        </IntegrationCard>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted">AI and research</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrationCard
          title="Google Gemini (AI writing)"
          c={c.GEMINI}
          serverKey={!!process.env.GEMINI_API_KEY?.trim()}
          canEdit={canEdit}
          canTest={false}
          capabilities={["Client-friendly audit summaries and finding explanations", "Output is checked against real findings before use"]}
          steps={<p>aistudio.google.com → Get API key → Create API key (free tier). Paste it below.</p>}
        >
          <ApiKeyForm provider="GEMINI" connected={c.GEMINI.hasSecret} disabled={!canEdit} />
        </IntegrationCard>
        <IntegrationCard
          title="PageSpeed Insights"
          c={c.PAGESPEED}
          serverKey={!!process.env.PAGESPEED_API_KEY?.trim()}
          canEdit={canEdit}
          canTest={false}
          capabilities={["Core Web Vitals (lab and real-user data) on the Research → Performance tab", "Without a key Google's shared quota is often exhausted"]}
          steps={<p>console.cloud.google.com → APIs &amp; Services → enable “PageSpeed Insights API” → Credentials → Create API key. Free: 25,000 tests per day.</p>}
        >
          <ApiKeyForm provider="PAGESPEED" connected={c.PAGESPEED.hasSecret} disabled={!canEdit} />
        </IntegrationCard>
        <IntegrationCard
          title="Google Places (Business Profile)"
          c={c.PLACES}
          serverKey={!!process.env.GOOGLE_PLACES_API_KEY?.trim()}
          canEdit={canEdit}
          canTest={false}
          capabilities={[
            "Fetches the prospect's Google Business Profile: rating, reviews, hours, photos, category",
            "Checks the position in Google Maps for the main services",
            "Without it, enter the profile figures by hand on Research → Google Business",
          ]}
          steps={
            <p>
              console.cloud.google.com → APIs &amp; Services → enable “Places API (New)” → Credentials → Create API key. Google requires a billing account on the project, but the free monthly quota covers normal use (about 1,000 profile lookups and 5,000 searches a month). Your PageSpeed key works too once Places is enabled on its project.
            </p>
          }
        >
          <ApiKeyForm provider="PLACES" connected={c.PLACES.hasSecret} disabled={!canEdit} />
        </IntegrationCard>
        {[
          ["Google Search Console", "Client queries, pages, clicks and positions (measured by Google)", "Ask the client for a Performance export (or access), then import Queries.csv / Pages.csv on a prospect's Research page."],
          ["Google Analytics 4", "Conversions from organic search", "Not connected in this version. Ask the client for a GA4 export; KPIs in proposals note that GA4 access is needed."],
          ["Ahrefs", "Keywords, referring domains (estimates)", "Export from Ahrefs with your own login and import on the Research page. Direct API access needs an Ahrefs Enterprise plan."],
          ["Semrush", "Keywords, backlinks (estimates)", "Export from Semrush and import on the Research page. The Semrush API needs a Business plan with API units."],
        ].map(([name, what, how]) => (
          <Card key={name} className="p-5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{name}</p>
              <Badge tone="info">CSV import</Badge>
            </div>
            <p className="mt-1 text-muted">{what}</p>
            <p className="mt-2">{how}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
