# External credentials

The app works without any of these. Each missing one turns off one feature, and the Integrations
page says which feature and what to enter.

Enter credentials **on the Integrations page**, not in chat or email. They are tested with the provider,
then stored encrypted. Keys set in `.env` are a fallback for the whole installation; a key entered
on the Integrations page takes priority for that workspace.

| Credential | Needed for | Where to get it | Where it goes | Cost |
|---|---|---|---|---|
| **Gmail App Password** | Sending proposals by email; saving Gmail drafts | https://myaccount.google.com/apppasswords. 2-Step Verification must be on. | Integrations → Gmail (App Password) | Free |
| Other SMTP account (Outlook, Zoho, cPanel mail…) | Email from a non-Gmail address | Your email provider's SMTP settings | Integrations → Other email (SMTP) | Usually included |
| Google OAuth client (`GOOGLE_CLIENT_ID` / `SECRET`) | Optional "Gmail via Google sign-in", which uses the narrower `gmail.compose` scope | Google Cloud Console → APIs & Services → Credentials → OAuth client (Web). Redirect URI: `<APP_URL>/api/integrations/google/callback`. Enable the Gmail API. | `.env`, then the **Sign in with Google** button | Free |
| **PageSpeed Insights API key** | Speed tests (lab data and real-user data) | Google Cloud Console → enable "PageSpeed Insights API" → Credentials → API key | Integrations → PageSpeed, or `PAGESPEED_API_KEY` | Free, 25,000 tests per day |
| Google Gemini API key | AI-written audit summary (optional; the rule-based summary works without it) | https://aistudio.google.com/apikey | Integrations → Gemini, or `GEMINI_API_KEY` | Free tier |
| WhatsApp Cloud API (permanent token, Phone Number ID, app secret, approved template) | Optional automatic WhatsApp sending. Click-to-chat needs nothing. | Meta for Developers → WhatsApp → API Setup; Business Settings → System Users for the token | Integrations → WhatsApp Business Platform | Free setup; Meta charges per conversation |
| Ahrefs / Semrush / Search Console | Keyword, backlink and query data | Export CSV files from your own accounts, or from the client's Search Console | Prospect → Research → Import CSV | Your existing plans |

## What is never needed

- **Ahrefs or Semrush logins.** The app does not sign in to your accounts or scrape them; it reads the CSV files you export.
- **Your normal Gmail password.** Only an App Password, which you can revoke at any time.
- **Scanning a QR code into WhatsApp.** The QR codes in the app only open a chat or a link. Unofficial WhatsApp Web automation is not used, because it gets numbers banned.

## Status in this installation (22 Oct 2026)

| Credential | Status |
|---|---|
| PageSpeed key | Set in `.env` and tested against the real API: a run on python.org returned lab and real-user (CrUX) data. |
| Gemini | AI Studio key set in `.env` and tested with a real structured generation (model `gemini-flash-latest`, currently Gemini 3.8 Flash). `gemini-2.5-flash` is no longer available to new keys, so the default follows Google's current Flash model. |
| Gmail App Password | Not entered yet. Sending was verified end-to-end against a local SMTP server; real Gmail sending is untested until the App Password is entered on the Integrations page. |
| Google OAuth, WhatsApp Cloud API | Not set (optional). |
